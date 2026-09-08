/**
 * @file SafetyRobotScene.tsx
 * @description Stationary humanoid concept illustrating a protective stop.
 * @feature landing
 */
import { memo } from 'react';

/** Decorative vector concept, deliberately not presented as product telemetry. */
export const SafetyRobotScene = memo(function SafetyRobotScene() {
  return (
    <svg className="safety-robot" viewBox="0 0 640 720" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id="robot-shell"
          x1="190"
          y1="100"
          x2="430"
          y2="470"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f5f7fb" />
          <stop offset=".3" stopColor="#aebbc9" />
          <stop offset=".55" stopColor="#e2e8ef" />
          <stop offset="1" stopColor="#53667a" />
        </linearGradient>
        <linearGradient id="robot-edge">
          <stop stopColor="#233244" />
          <stop offset=".5" stopColor="#5c6f84" />
          <stop offset="1" stopColor="#172333" />
        </linearGradient>
        <linearGradient id="robot-visor" x2="0" y2="1">
          <stop stopColor="#253d50" />
          <stop offset="1" stopColor="#070e19" />
        </linearGradient>
        <radialGradient id="robot-halo">
          <stop stopColor="currentColor" stopOpacity=".18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <pattern id="mission-grid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M36 0H0V36" stroke="#a0b8ce" strokeOpacity=".09" />
        </pattern>
      </defs>
      <circle cx="330" cy="330" r="290" fill="url(#robot-halo)" />
      <path
        d="M20 580L320 420 620 580 320 740Z"
        fill="url(#mission-grid)"
        stroke="#8ba1b5"
        strokeOpacity=".14"
      />
      <g className="mission-orbits" stroke="currentColor">
        <ellipse cx="322" cy="590" rx="231" ry="76" strokeOpacity=".16" />
        <ellipse cx="322" cy="590" rx="177" ry="58" strokeOpacity=".3" strokeDasharray="3 9" />
        <ellipse cx="322" cy="590" rx="122" ry="40" strokeOpacity=".5" />
        <path d="M91 590h28m406 0h28M322 505v18m0 135v18" strokeOpacity=".6" />
      </g>
      <ellipse cx="320" cy="600" rx="98" ry="24" fill="#000" opacity=".5" />
      <g className="safety-body" stroke="#0d1928" strokeWidth="2">
        {/* Legs and exposed knee actuators. */}
        <path d="M271 372L312 378 306 467 269 465 258 408Z" fill="url(#robot-shell)" />
        <path d="M331 378L371 372 383 409 373 465 336 467Z" fill="url(#robot-shell)" />
        <circle cx="285" cy="474" r="22" fill="url(#robot-edge)" />
        <circle cx="355" cy="474" r="22" fill="url(#robot-edge)" />
        <circle cx="285" cy="474" r="11" stroke="#7d91a5" />
        <circle cx="355" cy="474" r="11" stroke="#7d91a5" />
        <path d="M263 486L306 490 300 568 269 569 257 518Z" fill="url(#robot-shell)" />
        <path d="M336 490L378 486 384 518 371 569 340 568Z" fill="url(#robot-shell)" />
        <path d="M267 565L301 565 303 597 248 599 244 586Z" fill="url(#robot-edge)" />
        <path d="M339 565L372 565 394 587 390 599 336 597Z" fill="url(#robot-edge)" />
        <path d="M250 591h44m50 0h42" stroke="#b6c4d4" strokeWidth="3" />
        {/* Pelvis, waist and torso. */}
        <path
          d="M263 337Q320 320 378 337L369 392 338 409 319 390 302 408 270 391Z"
          fill="url(#robot-edge)"
        />
        <path d="M278 317H362V349H278Z" fill="#111e2c" />
        <path d="M285 325h70m-70 9h70" stroke="#6e7e8d" />
        <path
          d="M257 195L289 182H350L383 195 375 266 354 321Q320 334 283 321L265 269Z"
          fill="url(#robot-shell)"
        />
        <path d="M269 208L296 196H345L370 208 357 254Q320 270 283 254Z" fill="url(#robot-edge)" />
        <path d="M297 219H344" stroke="currentColor" strokeWidth="3" />
        <path d="M299 285h42m-45 8h48m-43 8h38" stroke="#657a90" strokeWidth="3" />
        <path d="M277 268l9 39m78-39-9 39" stroke="#f4f8fc" strokeOpacity=".55" />
        {/* Shoulders and arms. */}
        <circle cx="250" cy="218" r="27" fill="url(#robot-edge)" />
        <circle cx="391" cy="218" r="27" fill="url(#robot-edge)" />
        <path d="M226 217Q242 201 260 216L255 282 228 295 216 279Z" fill="url(#robot-shell)" />
        <path d="M382 215Q400 201 415 218L425 279 413 295 385 282Z" fill="url(#robot-shell)" />
        <circle cx="237" cy="297" r="18" fill="url(#robot-edge)" />
        <circle cx="404" cy="297" r="18" fill="url(#robot-edge)" />
        <path d="M220 308L250 309 244 360 225 377 212 365Z" fill="url(#robot-shell)" />
        <path d="M391 309L421 308 430 365 416 377 397 360Z" fill="url(#robot-shell)" />
        <path d="M218 373L241 373 247 404 239 421 216 413 210 391Z" fill="url(#robot-edge)" />
        <path d="M400 373L423 373 431 391 425 413 402 421 394 404Z" fill="url(#robot-edge)" />
        <path d="M220 389l3 19m5-21 3 23m179-23-3 23m11-21-3 19" stroke="#879aaf" />
        {/* Head, inset visor and neck. */}
        <path d="M301 159H340V188H301Z" fill="url(#robot-edge)" />
        <path
          d="M281 110Q281 86 307 82H334Q361 87 361 111L355 156 341 171H300L285 156Z"
          fill="url(#robot-shell)"
        />
        <path d="M290 111Q319 101 353 111L349 145Q321 156 294 145Z" fill="url(#robot-visor)" />
        <path d="M300 125H341" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M305 160h30" stroke="#5d7184" />
      </g>
      {/* A fixed boundary, not a scanning or walking animation. */}
      <g stroke="currentColor">
        <path d="M470 270V565M482 270V565" strokeOpacity=".45" strokeDasharray="4 6" />
        <path d="M490 285H570V520H490ZM490 355H570M490 435H570" strokeOpacity=".25" />
        <path d="M405 555H470M405 549V561M470 549V561" strokeOpacity=".7" />
      </g>
      <g stroke="currentColor" strokeOpacity=".65">
        <path d="M345 220H445L481 184H571" />
        <circle cx="345" cy="220" r="5" fill="#0b1723" />
        <path d="M270 347H181L145 383H67" />
        <circle cx="270" cy="347" r="4" fill="#0b1723" />
      </g>
      <g fill="#9fafc1" fontFamily="monospace" fontSize="9" letterSpacing="1.5">
        <text x="70" y="400">
          HUMANOID / CONCEPT
        </text>
        <text x="485" y="175">STOP LATCH</text>
        <text x="279" y="667">
          PROTECTIVE STOP
        </text>
      </g>
    </svg>
  );
});
