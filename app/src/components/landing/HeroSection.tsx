/**
 * @file HeroSection.tsx
 * @description Physical AI hero with an animated, multi-embodiment illustration.
 * @feature landing
 */
import { memo } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { useBrand } from "@/brand";
import { scrollToSection } from "./scrollToSection";
import "./hero.css";

/** A fleet member uses local coordinates so its stance can move independently. */
function FleetHumanoid() {
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <ellipse cy="103" rx="25" ry="8" fill="#030a13" opacity=".55" />
      <g fill="url(#scene-side)" stroke="#8ba7ba" strokeWidth="1.2">
        <path d="M-12 49L-14 72-11 96H-3L0 72 1 51Z" />
        <path d="M4 50L5 72 12 94 20 92 15 69 17 48Z" />
        <path d="M-12 96L-17 101-3 103 0 98Z" fill="#a3bacb" />
        <path d="M12 94L12 100 26 99 21 93Z" fill="#a3bacb" />
      </g>
      <g className="scene-humanoid-body">
        <path
          d="M-10 39L15 37 18 51 1 57-14 50Z"
          fill="#243f52"
          stroke="#89a7bb"
        />
        <path
          d="M-19 7L-3 0 23 10 16 36-5 44-20 31Z"
          fill="url(#scene-metal)"
          stroke="#c2d6e1"
        />
        <path d="M-19 7L-4 14 23 10M-4 14L-5 44" stroke="#66899f" />
        <path
          d="M-11 18L-1 22 14 17 11 29-2 34-11 29Z"
          fill="url(#scene-glass)"
        />
        <path d="M-6 24L4 26 10 23" stroke="#a1ffe0" strokeWidth="2" />
        <g
          className="scene-humanoid-arm"
          stroke="url(#scene-metal)"
          strokeWidth="8"
        >
          <path d="M-22 12L-29 31-25 49" />
          <path d="M25 16L30 35 26 51" />
        </g>
        <g fill="#243e50" stroke="#9ab7c9">
          <circle cx="-22" cy="12" r="5" />
          <circle cx="25" cy="16" r="5" />
          <circle cx="-29" cy="31" r="3" />
          <circle cx="30" cy="35" r="3" />
        </g>
        <path d="M-25 48V54M26 50V56" stroke="#91aebe" strokeWidth="6" />
        <path d="M0 1V-6" stroke="#7595a9" strokeWidth="7" />
        <g className="scene-humanoid-head">
          <path
            d="M-12-24L0-29 13-23 12-8 0-3-12-10Z"
            fill="url(#scene-metal)"
            stroke="#b7cddd"
          />
          <path d="M-10-20L0-16 11-20V-12L0-8-10-13Z" fill="#122735" />
          <path d="M-7-15L0-12 8-15" stroke="#b2ffe6" strokeWidth="1.5" />
        </g>
      </g>
      <path d="M-12 72H-4M8 72L15 70" stroke="#b5cad6" strokeWidth="3" />
    </g>
  );
}

/** Decorative concept art with a brief entrance and gentle ambient motion. */
function IntelligenceScene() {
  return (
    <div
      className="intelligence-field"
      role="img"
      aria-label="Physical AI concept: a fleet of three humanoids, a drone, a wheeled robot and a quadruped (robot dog) connected through a shared intelligence core."
    >
      <div className="field-caption">
        <span>ONE INTELLIGENCE. MANY FORMS.</span>
        <span>CONCEPT / 01</span>
      </div>
      <svg
        className="field-scene"
        viewBox="0 0 640 620"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="scene-metal" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#eef6ff" />
            <stop offset=".46" stopColor="#95adc1" />
            <stop offset="1" stopColor="#3a526a" />
          </linearGradient>
          <linearGradient id="scene-side" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#537087" />
            <stop offset="1" stopColor="#152839" />
          </linearGradient>
          <linearGradient id="scene-glass">
            <stop stopColor="#0b1b29" />
            <stop offset="1" stopColor="#315367" />
          </linearGradient>
          <radialGradient id="scene-glow">
            <stop stopColor="#65eed3" stopOpacity=".23" />
            <stop offset="1" stopColor="#65eed3" stopOpacity="0" />
          </radialGradient>
          <filter id="scene-soft">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <ellipse cx="338" cy="338" rx="280" ry="240" fill="url(#scene-glow)" />
        <g stroke="#80c7cd" strokeOpacity=".1">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path
              key={i}
              d={`M${60 + i * 48} ${320 - i * 24}l290 145M${60 + i * 48} ${320 + i * 24}l290-145`}
            />
          ))}
          <path d="M38 328L328 183 618 328 328 473Z" />
        </g>
        <g className="scene-orbits" stroke="#78bdbd">
          <ellipse cx="330" cy="337" rx="231" ry="111" strokeOpacity=".16" />
          <ellipse
            cx="330"
            cy="337"
            rx="204"
            ry="96"
            strokeOpacity=".25"
            strokeDasharray="2 8"
          />
          <ellipse
            className="scene-signal"
            cx="330"
            cy="337"
            rx="231"
            ry="111"
            stroke="#a1f9df"
            strokeWidth="2"
            strokeDasharray="85 1025"
          />
        </g>
        <g
          className="scene-connections"
          stroke="#99edd9"
          strokeOpacity=".45"
          strokeDasharray="3 6"
        >
          <path d="M330 322V204L401 168M330 350L181 428M351 352L475 421M294 305L174 252" />
        </g>
        {/* Three humanoids share a formation, with slightly staggered idle motion. */}
        <g className="scene-fleet">
          <g transform="translate(105 176) scale(.65)">
            <FleetHumanoid />
          </g>
          <g transform="translate(183 186) scale(.7)">
            <FleetHumanoid />
          </g>
          <g transform="translate(140 204) scale(.83)">
            <FleetHumanoid />
          </g>
        </g>
        {/* Shared intelligence core, drawn as a floating stack of glass and metal. */}
        <g className="scene-core">
          <ellipse
            cx="330"
            cy="358"
            rx="76"
            ry="30"
            fill="#85f6d7"
            opacity=".15"
            filter="url(#scene-soft)"
          />
          <path
            d="M252 323L330 284 408 323V346L330 385 252 346Z"
            fill="url(#scene-side)"
            stroke="#6d9caa"
          />
          <path
            d="M252 323L330 362 408 323M330 362V385"
            stroke="#96dbd1"
            strokeOpacity=".55"
          />
          <path
            d="M252 323L330 284 408 323 330 362Z"
            fill="#142d39"
            stroke="#a5eadb"
          />
          <path
            d="M268 309L330 278 392 309 330 340Z"
            fill="#6dd9c8"
            fillOpacity=".08"
            stroke="#b4ffeb"
            strokeOpacity=".65"
          />
          <path
            d="M285 300L330 277 375 300 330 323Z"
            fill="#a4ffe2"
            fillOpacity=".12"
            stroke="#b4ffeb"
          />
          <path className="scene-core-light" d="M305 300L330 287 355 300 330 313Z" fill="#c6ffee" />
          {[0, 1, 2, 3, 4].map((i) => (
            <path
              key={i}
              d={`M${269 + i * 11} ${345 + i * 5.5}v6`}
              stroke="#99eed7"
              strokeWidth="2"
            />
          ))}
        </g>
        {/* Drone: four rotor assemblies, articulated arms, camera and landing gear. */}
        <g transform="translate(410 145)">
          <g className="scene-drone-hover">
            <g className="scene-drone" strokeLinejoin="round">
              <path
                d="M-25-8L-78-32M24-8L78-32M-23 11L-76 38M24 11L78 38"
                stroke="#3e596e"
                strokeWidth="12"
              />
              <path
                d="M-25-11L-78-35M24-11L78-35M-23 8L-76 35M24 8L78 35"
                stroke="#a5bccc"
                strokeWidth="5"
              />
              {[-1, 1].flatMap((x) =>
                [-1, 1].map((y) => (
                  <g
                    key={`${x}-${y}`}
                    transform={`translate(${x * 79} ${y === -1 ? -35 : 36})`}
                  >
                    <ellipse
                      rx="41"
                      ry="14"
                      fill="#84c9ce"
                      fillOpacity=".04"
                      stroke="#7c9aa8"
                      strokeOpacity=".65"
                    />
                    <ellipse
                      className="scene-rotor"
                      rx="34"
                      ry="9"
                      stroke="#d5eeee"
                      strokeDasharray="35 14"
                    />
                    <path d="M0-5V8" stroke="#bed0db" strokeWidth="7" />
                    <ellipse cy="-5" rx="6" ry="3" fill="#e5eff4" />
                  </g>
                )),
              )}
              <path
                d="M-33-9L-5-24 35-7 27 15-3 29-30 12Z"
                fill="url(#scene-metal)"
                stroke="#c2d6e0"
              />
              <path
                d="M-30 12L-3 29 27 15V3L-3 16-33-1"
                fill="url(#scene-side)"
              />
              <path d="M-20-9L-4-17 21-7 3 3Z" fill="url(#scene-glass)" />
              <path
                d="M-20 19L-25 37-10 43M20 21L24 36 12 42"
                stroke="#8daabb"
                strokeWidth="3"
              />
              <path d="M-2 27V34" stroke="#95b3c3" strokeWidth="6" />
              <rect
                x="-10"
                y="32"
                width="20"
                height="13"
                rx="5"
                fill="#182a3b"
                stroke="#8daabb"
              />
              <circle cy="38" r="4" fill="#8cf5dc" />
              <path d="M-27 6L-15 12" stroke="#b1ffe8" strokeWidth="3" />
            </g>
          </g>
        </g>
        {/* Autonomous mobile robot: raised lidar, protective chassis and wheels. */}
        <g transform="translate(160 417)">
          <g className="scene-rover" strokeLinejoin="round">
            <ellipse cy="72" rx="87" ry="26" fill="#030a13" opacity=".6" />
            <g fill="#101c29" stroke="#496071" strokeWidth="3">
              <ellipse cx="-48" cy="42" rx="15" ry="23" />
              <ellipse cx="49" cy="40" rx="15" ry="23" />
              <ellipse cx="-3" cy="64" rx="15" ry="23" />
            </g>
            <path
              d="M-70 3L-7-30 66 4V40L2 74-70 38Z"
              fill="url(#scene-side)"
              stroke="#6f91a6"
            />
            <path
              d="M-70 3L-7-30 66 4 2 38Z"
              fill="url(#scene-metal)"
              stroke="#bfd1dc"
            />
            <path d="M-62 12L2 44 58 15V33L2 62-62 30Z" fill="#101f2d" />
            <path
              d="M-54 17L-18 35M15 43L46 27"
              stroke="#a9ffe5"
              strokeWidth="3"
            />
            <path d="M-35-6L-8-20 26-4-1 10Z" fill="#526f82" />
            <path d="M-8-15V-41" stroke="#7895a6" strokeWidth="8" />
            <path
              d="M-22-43V-34C-22-26 9-26 9-34V-43"
              fill="#273e50"
              stroke="#94afbe"
            />
            <ellipse cx="-6.5" cy="-43" rx="15.5" ry="7" fill="#c3d6df" />
            <path d="M-19-35Q-7-30 6-35" stroke="#a1f9df" strokeWidth="2" />
            <circle cx="-51" cy="44" r="4" fill="#9cb6c6" />
            <path d="M22 53L45 41" stroke="#718b9d" strokeWidth="2" />
          </g>
        </g>
        {/* Quadruped: four distinct jointed legs and a front sensor face. */}
        <g transform="translate(471 424)">
          <g className="scene-dog" strokeLinejoin="round" strokeLinecap="round">
            <ellipse
              cx="0"
              cy="82"
              rx="86"
              ry="23"
              fill="#030a13"
              opacity=".6"
            />
            <g stroke="#496578" strokeWidth="12">
              <path d="M-43-2L-55 34-38 67" />
              <path d="M27 0L17 33 34 63" />
            </g>
            <path
              d="M-62-29L-27-48 57-16 27 4Z"
              fill="url(#scene-metal)"
              stroke="#d4e2e9"
            />
            <path
              d="M-62-29L27 4V33L-61 0Z"
              fill="url(#scene-side)"
              stroke="#8aa5b6"
            />
            <path d="M27 4L57-16V13L27 33Z" fill="#142a3b" stroke="#859dad" />
            <path d="M-47-27L-25-38 35-15 15-4Z" fill="#8ca6b8" />
            <path
              d="M-35-27L4-12M-26-31L13-16"
              stroke="#405d71"
              strokeWidth="2"
            />
            <g stroke="url(#scene-metal)" strokeWidth="13">
              <path d="M-47 8L-56 45-38 80" />
              <path d="M20 31L9 61 31 88" />
            </g>
            <g fill="#20394a" stroke="#9bb5c5" strokeWidth="2">
              <circle cx="-47" cy="8" r="10" />
              <circle cx="20" cy="31" r="10" />
              <circle cx="-56" cy="45" r="7" />
              <circle cx="9" cy="61" r="7" />
            </g>
            <path
              d="M-44 82L-31 84M25 90L39 91M-44 69L-33 71M29 65L40 67"
              stroke="#111f2d"
              strokeWidth="7"
            />
            <path d="M35 5L49-4" stroke="#a1ffe0" strokeWidth="4" />
            <circle cx="41" cy="15" r="3" fill="#91b2c6" />
          </g>
        </g>
        <g
          className="scene-labels"
          fill="#9bb2c5"
          fontFamily="monospace"
          fontSize="9"
          letterSpacing="1.6"
        >
          <text x="60" y="117">
            04 / HUMANOID FLEET
          </text>
          <path fill="none" d="M85 129V145H102" stroke="#52697d" />
          <text x="408" y="74">
            01 / AERIAL
          </text>
          <path fill="none" d="M393 70H370V102" stroke="#52697d" />
          <text x="62" y="553">
            02 / WHEELED
          </text>
          <path fill="none" d="M150 533V544H137" stroke="#52697d" />
          <text x="405" y="565">
            03 / QUADRUPED
          </text>
          <text x="405" y="581" fontSize="8" letterSpacing=".7" fill="#7994aa">
            ROBOT DOG
          </text>
          <text x="297" y="412" fontSize="8" fill="#b3eddc">
            PHYSICAL AI
          </text>
        </g>
      </svg>
      <div className="field-scene-footer">
        <span>Different bodies.</span>
        <span>Shared possibility.</span>
      </div>
    </div>
  );
}

export const HeroSection = memo(function HeroSection() {
  const brand = useBrand();
  return (
    <section className="field-hero" aria-labelledby="hero-heading">
      <div className="field-grid" aria-hidden="true" />
      <div className="lp-container field-content">
        <div className="field-layout">
          <div className="field-copy">
            <p className="field-kicker">
              <span /> {brand.name} / THE OPEN PHYSICAL AI PLATFORM
            </p>
            <h1 id="hero-heading">
              Intelligence.
              <br />
              Beyond
              <br />
              the screen.
            </h1>
            <p className="field-lede">
              Different bodies. One continuous loop.
              <br />
              Turn robot experience into intelligence — and bring it back into
              the world.
            </p>
            <div className="field-actions">
              <Link to="/dashboard" className="field-primary">
                Explore the platform <ArrowUpRight size={18} />
              </Link>
              <a
                href="#circle"
                onClick={(event) => scrollToSection(event, "#circle")}
              >
                Discover the Embodied Loop <ArrowDown size={16} />
              </a>
            </div>
          </div>
          <IntelligenceScene />
        </div>
        <div className="field-footnote">
          <span>OPEN SOURCE. YOUR MODELS. YOUR HARDWARE. YOUR CONTROL.</span>
          <span>
            Hardware-agnostic architecture. Integration readiness varies by
            robot.
          </span>
        </div>
      </div>
    </section>
  );
});
