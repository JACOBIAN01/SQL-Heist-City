import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

// usage: node build-skins.mjs <Universal Base Characters dir> <out dir>
// The light skin tones are swapped in at runtime (the dark ones are baked into the GLBs).
const [, , packDir, outDir] = process.argv;
mkdirSync(outDir, { recursive: true });
const textures = {
  'skin_male_light.webp': 'Base Characters/Textures/T_Superhero_Male_Ligh.png',
  'skin_female_light.webp': 'Base Characters/Textures/T_Superhero_Female_Light_BaseColor.png',
};
for (const [out, src] of Object.entries(textures)) {
  await sharp(`${packDir}/${src}`)
    .resize(512, 512, { fit: 'inside' })
    .webp({ quality: 82 })
    .toFile(`${outDir}/${out}`);
  console.log(out);
}
