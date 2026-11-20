/** Quiet original cave silhouettes; gameplay item art comes from Minecraft. */
export function CaveScene() {
  return <div className="cave-scene" aria-hidden="true">
    <svg className="cave-art" viewBox="0 0 1600 1100" preserveAspectRatio="xMidYMid slice" fill="none">
      <path fill="#25303a" d="M0 0h270l105 118-28 169-126 149 24 178-105 193L0 928z"/>
      <path fill="#1c252e" d="m0 223 167-37 127 93-73 157 24 178-108 96L0 749z"/>
      <path fill="#222c35" d="M1600 0h-241l-113 133 41 179 105 133-31 206 112 191 127 84z"/>
      <path fill="#1b242d" d="m1600 282-173-46-141 76 106 133-31 206 124 89 115 32z"/>
      <path fill="#1b242c" d="M0 0h1600v90l-207-32-179 35-173-50-258 25-242-28-211 49-180-40L0 104z"/>
    </svg>
    <div className="cave-vignette"/>
  </div>
}
