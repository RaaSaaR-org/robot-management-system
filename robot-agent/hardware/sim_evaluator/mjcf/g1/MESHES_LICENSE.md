# Unitree G1 model + meshes — attribution & license

The MuJoCo model `g1_29dof.xml` (this directory) and every `meshes/*.STL` file
are **vendored from Unitree's official MuJoCo repository** and redistributed
here under the BSD 3-Clause License.

| | |
|---|---|
| **Upstream** | https://github.com/unitreerobotics/unitree_mujoco |
| **Path** | `unitree_robots/g1/` (`g1_29dof.xml` + `meshes/`) |
| **Pinned commit** | `ae6a8403e272733e9996ef59990880330496177f` |
| **License** | BSD 3-Clause |
| **Copyright** | (c) 2016-2024 HangZhou YuShu TECHNOLOGY CO.,LTD. ("Unitree Robotics") |

## What was modified

`g1_29dof.xml` here is **derived** from the upstream standalone model (so it
composes into `scene_builder` scenes) by `build_g1_include.py`. The STL meshes
are byte-for-byte copies. See the header comment in `g1_29dof.xml` for the exact
modifications (dropped `<compiler>`, prefixed mesh paths, position actuators,
added `head_camera`). Re-vendor / bump the pin with:

```bash
uv run python mjcf/g1/build_g1_include.py /path/to/unitree_mujoco/unitree_robots/g1
```

## License text

```
BSD 3-Clause License

Copyright (c) 2016-2024 HangZhou YuShu TECHNOLOGY CO.,LTD. ("Unitree Robotics")
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
