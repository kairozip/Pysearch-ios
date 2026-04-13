/**
 * Build Windows assets/icon.ico + assets/icon.png from pysearch_mascot.png
 * (same artwork as EXE, taskbar, desktop shortcut — electron-builder win.icon).
 *
 * Run after: npm run fix-mascot
 * Usage: node tools/build-app-icons.js
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const toIco = require('to-ico');

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'assets', 'pysearch_mascot.png');
const icoOut = path.join(ROOT, 'assets', 'icon.ico');
const pngOut = path.join(ROOT, 'assets', 'icon.png');

function buildPngForSize(size) {
    // For tiny icon sizes, a bit of sharpening helps keep edges crisp.
    const img = sharp(src)
        .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            kernel: sharp.kernel.lanczos3,
        });

    if (size <= 48) {
        return img.sharpen(0.9, 0.6, 2.2).png().toBuffer();
    }
    return img.png().toBuffer();
}

async function main() {
    if (!fs.existsSync(src)) {
        console.error('Missing source:', src);
        process.exit(1);
    }

    // Single 256×256 PNG for Electron BrowserWindow fallback (alpha preserved)
    await sharp(await buildPngForSize(256)).toFile(pngOut);
    console.log('Wrote', pngOut);

    const sizes = [256, 128, 96, 64, 48, 40, 32, 24, 16];
    const buffers = await Promise.all(sizes.map((s) => buildPngForSize(s)));

    const icoBuffer = await toIco(buffers);
    fs.writeFileSync(icoOut, icoBuffer);
    console.log('Wrote', icoOut, `(${sizes.join(', ')} px)`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
