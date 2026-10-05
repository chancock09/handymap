import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#101918"/>
  <g fill="none" stroke="#8fbaab" stroke-width="1" opacity="0.14">
    ${Array.from({ length: 13 }, (_, i) => `<line x1="0" y1="${i * 52.5}" x2="1200" y2="${i * 52.5}"/>`).join("")}
    ${Array.from({ length: 24 }, (_, i) => `<line x1="${i * 52.5}" y1="0" x2="${i * 52.5}" y2="630"/>`).join("")}
  </g>
  <g transform="translate(930 315)">
    <circle r="150" fill="none" stroke="#b8ef98" stroke-width="10" opacity="0.18"/>
    <circle r="100" fill="none" stroke="#b8ef98" stroke-width="12" opacity="0.5"/>
    <circle r="60" fill="none" stroke="#b8ef98" stroke-width="16"/>
    <circle r="27" fill="#b8ef98"/>
  </g>
  <g font-family="Inter, 'Avenir Next', Avenir, 'Helvetica Neue', Helvetica, Arial, sans-serif">
    <text x="96" y="146" font-size="26" letter-spacing="4" fill="#a1afa5" font-family="'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace">A SHARED LITTLE WORLD</text>
    <text x="92" y="300" font-size="124" font-weight="600" letter-spacing="-5" fill="#e4eadf">Hello World</text>
    <text x="96" y="378" font-size="42" fill="#b8ef98">One world. One ping at a time.</text>
    <text x="96" y="520" font-size="28" fill="#a1afa5">hello-world.gobbi.tech</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile("public/share.png");
console.log("Wrote public/share.png");
