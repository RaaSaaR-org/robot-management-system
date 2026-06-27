"""
pointcloud_replay.py — Read REAL recorded point clouds for the G1 sidecar.

Pure-stdlib parsers (no numpy / open3d) for the formats real LiDAR exports use:
  • PCD (PointCloudLibrary): DATA ascii | binary | binary_compressed (LZF)
  • KITTI Velodyne .bin: interleaved float32 x,y,z,intensity

Turns a recording into flat lists matching the Node HardwareClient /
PointCloudFrame contract (base frame x-forward, y-left, z-up, meters; intensity
0..1), so g1_sidecar.py's /pointcloud/<name>/snapshot can serve genuine sensor
data when no physical Livox is attached — exercising the real hardware seam
end-to-end. Mirrors the TS PointCloudReplaySource.

@status live
"""

import os
import struct

# ---------------------------------------------------------------------------
# LZF decompression (liblzf) — PCD `DATA binary_compressed`
# ---------------------------------------------------------------------------


def lzf_decompress(src: bytes, out_len: int) -> bytes:
    out = bytearray(out_len)
    ip = op = 0
    n = len(src)
    while ip < n:
        ctrl = src[ip]
        ip += 1
        if ctrl < 32:  # literal run of ctrl+1 bytes
            ln = ctrl + 1
            out[op:op + ln] = src[ip:ip + ln]
            ip += ln
            op += ln
        else:  # back reference
            ln = ctrl >> 5
            if ln == 7:
                ln += src[ip]
                ip += 1
            ref = op - ((ctrl & 0x1F) << 8) - 1 - src[ip]
            ip += 1
            for _ in range(ln + 2):
                out[op] = out[ref]
                op += 1
                ref += 1
    return bytes(out)


# ---------------------------------------------------------------------------
# Parsers → (xs, ys, zs, intensities, has_intensity)
# ---------------------------------------------------------------------------

_NUMSTRUCT = {("F", 4): "<f", ("F", 8): "<d"}


def _read_numeric(buf: bytes, off: int, typ: str, size: int) -> float:
    fmt = _NUMSTRUCT.get((typ, size))
    if fmt:
        return struct.unpack_from(fmt, buf, off)[0]
    if typ == "U":
        return float(int.from_bytes(buf[off:off + size], "little", signed=False))
    return float(int.from_bytes(buf[off:off + size], "little", signed=True))


def parse_pcd(raw: bytes):
    # Header is ascii up to and including the DATA line.
    idx = raw.find(b"\nDATA")
    nl = raw.find(b"\n", idx + 1)
    header = raw[:nl].decode("ascii", "replace")
    data_start = nl + 1
    fields, sizes, types, counts = [], [], [], []
    data_kind = "ascii"
    for line in header.splitlines():
        parts = line.strip().split()
        if not parts or parts[0].startswith("#"):
            continue
        key = parts[0].upper()
        if key == "FIELDS":
            fields = [p.lower() for p in parts[1:]]
        elif key == "SIZE":
            sizes = [int(p) for p in parts[1:]]
        elif key == "TYPE":
            types = [p.upper() for p in parts[1:]]
        elif key == "COUNT":
            counts = [int(p) for p in parts[1:]]
        elif key == "POINTS":
            npts = int(parts[1])
        elif key == "WIDTH":
            width = int(parts[1])
        elif key == "HEIGHT":
            height = int(parts[1])
        elif key == "DATA":
            data_kind = parts[1].lower()
    if not counts:
        counts = [1] * len(fields)
    try:
        npts
    except NameError:
        npts = width * height

    fi = {name: i for i, name in enumerate(fields)}
    if not all(k in fi for k in ("x", "y", "z")):
        raise ValueError("PCD missing x/y/z fields: %s" % fields)
    has_i = "intensity" in fi or "i" in fi
    iname = "intensity" if "intensity" in fi else ("i" if "i" in fi else None)

    xs, ys, zs, ii = [], [], [], []

    if data_kind == "ascii":
        # Column index of each field accounting for COUNT.
        col = {}
        c = 0
        for name, cnt in zip(fields, counts):
            col[name] = c
            c += cnt
        text = raw[data_start:].decode("ascii", "replace")
        for row in text.splitlines():
            row = row.strip()
            if not row or row.startswith("#"):
                continue
            vals = row.split()
            xs.append(float(vals[col["x"]]))
            ys.append(float(vals[col["y"]]))
            zs.append(float(vals[col["z"]]))
            if iname:
                ii.append(float(vals[col[iname]]))
            if len(xs) >= npts:
                break
        return xs, ys, zs, ii, has_i

    # offsets within an interleaved record
    offsets, stride = {}, 0
    for name, size, cnt in zip(fields, sizes, counts):
        offsets[name] = stride
        stride += size * cnt
    tmap = dict(zip(fields, types))
    smap = dict(zip(fields, sizes))

    if data_kind == "binary":
        body = raw[data_start:]
        for p in range(npts):
            base = p * stride
            xs.append(_read_numeric(body, base + offsets["x"], tmap["x"], smap["x"]))
            ys.append(_read_numeric(body, base + offsets["y"], tmap["y"], smap["y"]))
            zs.append(_read_numeric(body, base + offsets["z"], tmap["z"], smap["z"]))
            if iname:
                ii.append(_read_numeric(body, base + offsets[iname], tmap[iname], smap[iname]))
        return xs, ys, zs, ii, has_i

    if data_kind == "binary_compressed":
        comp_size, uncomp_size = struct.unpack_from("<II", raw, data_start)
        comp = raw[data_start + 8: data_start + 8 + comp_size]
        body = lzf_decompress(comp, uncomp_size)
        # field-major (SoA): each field's values are contiguous
        fstart, acc = {}, 0
        for name, size, cnt in zip(fields, sizes, counts):
            fstart[name] = acc
            acc += npts * size * cnt
        for p in range(npts):
            xs.append(_read_numeric(body, fstart["x"] + p * smap["x"], tmap["x"], smap["x"]))
            ys.append(_read_numeric(body, fstart["y"] + p * smap["y"], tmap["y"], smap["y"]))
            zs.append(_read_numeric(body, fstart["z"] + p * smap["z"], tmap["z"], smap["z"]))
            if iname:
                ii.append(_read_numeric(body, fstart[iname] + p * smap[iname], tmap[iname], smap[iname]))
        return xs, ys, zs, ii, has_i

    raise ValueError("unsupported PCD DATA kind: %s" % data_kind)


def parse_kitti_bin(raw: bytes):
    n = len(raw) // 16
    vals = struct.unpack_from("<%df" % (n * 4), raw, 0)
    xs = list(vals[0::4])
    ys = list(vals[1::4])
    zs = list(vals[2::4])
    ii = list(vals[3::4])
    return xs, ys, zs, ii, True


# ---------------------------------------------------------------------------
# Normalize → base frame + interleave
# ---------------------------------------------------------------------------


def _normalize(xs, ys, zs, ii, has_i):
    n = len(xs)
    if n == 0:
        return [], [], False
    cx = sum(xs) / n
    cy = sum(ys) / n
    floor = min(zs)
    positions = []
    for i in range(n):
        positions.append(xs[i] - cx)
        positions.append(ys[i] - cy)
        positions.append(zs[i] - floor)
    intensities = []
    if has_i and ii:
        mx = max(ii) or 1.0
        inv = 1.0 / mx if mx > 0 else 1.0
        intensities = [max(0.0, min(1.0, v * inv)) for v in ii]
    return positions, intensities, has_i


def load_frame(path: str, name: str):
    """Load + normalize one real recording into the PointCloudFrame contract.

    Returns dict {positions, intensities, has_intensity, sensor_type} where
    positions is flat [x0,y0,z0, ...] in base frame, intensities is 0..1.
    """
    with open(path, "rb") as f:
        raw = f.read()
    lower = path.lower()
    if lower.endswith(".bin"):
        xs, ys, zs, ii, has_i = parse_kitti_bin(raw)
    else:
        xs, ys, zs, ii, has_i = parse_pcd(raw)
    positions, intensities, has_i = _normalize(xs, ys, zs, ii, has_i)
    sensor_type = "depth_camera" if name == "d435i_depth" else "lidar"
    return {
        "positions": positions,
        "intensities": intensities,
        "has_intensity": has_i,
        "sensor_type": sensor_type,
    }


def resolve_replay_path(name: str):
    """Pick a recording for `name` from G1_POINTCLOUD_REPLAY (file or dir)."""
    src = os.environ.get("G1_POINTCLOUD_REPLAY", "").strip()
    if not src:
        return None
    if os.path.isdir(src):
        files = sorted(
            f for f in os.listdir(src) if f.lower().endswith((".pcd", ".bin"))
        )
        if not files:
            return None
        # Map the two G1 sensors onto the first two recordings if present.
        idx = 1 if (name == "d435i_depth" and len(files) > 1) else 0
        return os.path.join(src, files[idx])
    return src if os.path.isfile(src) else None
