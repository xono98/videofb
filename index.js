import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import Together from 'together-ai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

ffmpeg.setFfmpegPath(ffmpegPath);

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });
const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

// Load prompt
function getRandomPrompt() {
  const prompts = fs.readFileSync('prompts.txt', 'utf-8').split('\n').filter(Boolean);
  return prompts[Math.floor(Math.random() * Math.min(30, prompts.length))];
}

// Load caption
function getRandomCaption() {
  const sections = fs.readFileSync('caption.txt', 'utf-8').split('===').filter(s => s.trim().length > 10);
  return sections[Math.floor(Math.random() * sections.length)].trim();
}

// Generate image
async function generateImage(prompt) {
  const response = await together.images.create({
    model: 'black-forest-labs/FLUX.1-schnell-Free',
    prompt: `${prompt}. 1080x1920, 9:16 vertical portrait, cinematic art, sharp focus, beautiful lighting`,
    steps: 4,
    n: 1,
    size: '1080x1920'
  });

  const imageUrl = response.data[0]?.url;
  if (!imageUrl) throw new Error('No image URL returned');

  const res = await fetch(imageUrl);
  const buffer = await res.buffer();
  const rawPath = 'raw_image.png';
  fs.writeFileSync(rawPath, buffer);
  console.log('✅ Image saved as', rawPath);
  return rawPath;
}

// Crop/resize to 1080x1920
async function cropToPortrait(inputPath) {
  const outputPath = 'cropped_image.png';
  await sharp(inputPath)
    .resize(1080, 1920, { fit: 'cover' }) // ensures true 9:16
    .toFile(outputPath);
  console.log('✅ Image cropped to 1080x1920');
  return outputPath;
}

// Create zoom-in video
function createZoomVideo(imagePath, outputPath = 'output_video.mp4') {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions('-loop 1')
      .outputOptions('-t 5') // 5 seconds
      .videoFilters([
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
        "zoompan=z='min(zoom+0.0005,1.5)':d=125:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=25"
      ])
      .outputOptions('-pix_fmt yuv420p')
      .output(outputPath)
      .on('end', () => {
        console.log('🎞 Video created:', outputPath);
        resolve(outputPath);
      })
      .on('error', reject)
      .run();
  });
}

// Upload to Facebook
async function postToFacebook(videoPath, caption) {
  const form = new FormData();
  form.append('access_token', ACCESS_TOKEN);
  form.append('description', caption);
  form.append('source', fs.createReadStream(videoPath));

  const res = await fetch(`https://graph.facebook.com/v16.0/${PAGE_ID}/videos`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Upload failed');

  console.log('📲 Posted video! Facebook ID:', data.id);
}

// MAIN
(async () => {
  try {
    const prompt = getRandomPrompt();
    const caption = getRandomCaption();
    console.log('🧠 Prompt:', prompt);
    console.log('📝 Caption:', caption);

    const rawImage = await generateImage(prompt);
    const croppedImage = await cropToPortrait(rawImage);
    const video = await createZoomVideo(croppedImage);
    await postToFacebook(video, caption);

    console.log('✅ All Done!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
})();
