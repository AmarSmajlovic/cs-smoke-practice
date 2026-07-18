// Screenshot the live main menu at OG-card size (1200x630) for og:image.
// Usage: node tools/og-shot.mjs [url] [outfile]
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'https://www.smokepractice.com/';
const out = process.argv[3] || 'public/og.jpg';

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000)); // let thumbs/fonts settle
await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
await browser.close();
console.log('saved', out);
