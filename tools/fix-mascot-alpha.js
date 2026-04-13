/**
 * Remove baked-in checkerboard + stray grey/black pixels → real PNG alpha.
 * 1) Estimates checker colours from the image border.
 * 2) Flood-fills from all edges through pixels that read as "background"
 *    (checker match, near checker swatches, flat light greys, dark specks).
 *
 * Usage: node tools/fix-mascot-alpha.js [input.png] [output.png]
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const inputPath = process.argv[2] || path.join(ROOT, 'assets', 'pysearch_mascot.png');
const outputPath = process.argv[3] || path.join(ROOT, 'assets', 'pysearch_mascot.png');

const CHECKER_FUZZ = 44;
const SWATCH_FUZZ = 56;

function dist3(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function kmeans2(samples, iters = 14) {
    let c0 = [...samples[0]];
    let c1 = [...samples[Math.min(samples.length - 1, 80)]];
    for (let it = 0; it < iters; it++) {
        const sum0 = [0, 0, 0],
            sum1 = [0, 0, 0];
        let n0 = 0,
            n1 = 0;
        for (const p of samples) {
            if (dist3(p, c0) <= dist3(p, c1)) {
                sum0[0] += p[0];
                sum0[1] += p[1];
                sum0[2] += p[2];
                n0++;
            } else {
                sum1[0] += p[0];
                sum1[1] += p[1];
                sum1[2] += p[2];
                n1++;
            }
        }
        if (n0) c0 = [sum0[0] / n0, sum0[1] / n0, sum0[2] / n0];
        if (n1) c1 = [sum1[0] / n1, sum1[1] / n1, sum1[2] / n1];
    }
    return { c0, c1 };
}

function lum(c) {
    return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
}

function isNearBlack(rgb) {
    const [r, g, b] = rgb;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const mean = (r + g + b) / 3;
    // Solid black / dark mat used as fake background in exports
    if (mean < 22 && mx - mn < 28) return true;
    if (mx < 48 && mn < 36 && mx - mn < 24) return true;
    return false;
}

function isBackgroundPixel(rgb, x, y, light, dark, useLightAt00) {
    const [r, g, b] = rgb;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const mean = (r + g + b) / 3;

    if (isNearBlack(rgb)) return true;

    if (Math.min(dist3(rgb, light), dist3(rgb, dark)) <= SWATCH_FUZZ) return true;

    const expectLight = ((x + y) & 1) === 0 ? useLightAt00 : !useLightAt00;
    const expected = expectLight ? light : dark;
    if (dist3(rgb, expected) <= CHECKER_FUZZ) return true;

    // Flat light greys / white halos (not saturated purple metal)
    if (mean > 198 && spread < 38) return true;
    if (mean > 165 && spread < 20) return true;
    // Dark compression / noise pixels in former “transparent” areas
    if (mean < 85 && spread < 52) return true;

    return false;
}

async function main() {
    if (!fs.existsSync(inputPath)) {
        console.error('Missing:', inputPath);
        process.exit(1);
    }

    const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const ch = info.channels;
    if (ch < 3) {
        console.error('Need RGB image');
        process.exit(1);
    }

    const getRgb = (x, y) => {
        const i = (y * w + x) * ch;
        return [data[i], data[i + 1], data[i + 2]];
    };

    const border = [];
    for (let x = 0; x < w; x++) {
        border.push(getRgb(x, 0));
        border.push(getRgb(x, h - 1));
    }
    for (let y = 0; y < h; y++) {
        border.push(getRgb(0, y));
        border.push(getRgb(w - 1, y));
    }

    const { c0, c1 } = kmeans2(border);
    let light = c0;
    let dark = c1;
    if (lum(c1) > lum(c0)) {
        light = c1;
        dark = c0;
    }

    const p00 = getRgb(0, 0);
    const useLightAt00 = dist3(p00, light) <= dist3(p00, dark);

    const idx = (x, y) => y * w + x;
    const visited = new Uint8Array(w * h);
    const q = [];

    function tryPush(x, y) {
        if (x < 0 || x >= w || y < 0 || y >= h) return;
        const i = idx(x, y);
        if (visited[i]) return;
        const rgb = getRgb(x, y);
        if (!isBackgroundPixel(rgb, x, y, light, dark, useLightAt00)) return;
        visited[i] = 1;
        q.push(x, y);
    }

    for (let x = 0; x < w; x++) {
        tryPush(x, 0);
        tryPush(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
        tryPush(0, y);
        tryPush(w - 1, y);
    }

    for (let qi = 0; qi < q.length; qi += 2) {
        const x = q[qi];
        const y = q[qi + 1];
        tryPush(x - 1, y);
        tryPush(x + 1, y);
        tryPush(x, y - 1);
        tryPush(x, y + 1);
    }

    const out = Buffer.from(data);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * ch;
            if (visited[idx(x, y)]) {
                out[i + 3] = 0;
            } else {
                out[i + 3] = 255;
            }
        }
    }

    // Enclosed holes (checker inside the “P” loop): not edge-connected — key by colour again
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * ch;
            if (out[i + 3] === 0) continue;
            const rgb = [out[i], out[i + 1], out[i + 2]];
            if (isBackgroundPixel(rgb, x, y, light, dark, useLightAt00)) {
                out[i + 3] = 0;
            }
        }
    }

    // Despeckle: tiny opaque islands fully surrounded by transparent → remove
    const alpha = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            alpha[idx(x, y)] = out[(y * w + x) * ch + 3];
        }
    }
    for (let pass = 0; pass < 2; pass++) {
        const next = Uint8Array.from(alpha);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                if (alpha[idx(x, y)] === 0) continue;
                let t = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if (alpha[idx(x + dx, y + dy)] === 0) t++;
                    }
                }
                if (t >= 7) next[idx(x, y)] = 0;
            }
        }
        for (let i = 0; i < alpha.length; i++) alpha[i] = next[i];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * ch;
            out[i + 3] = alpha[idx(x, y)];
        }
    }

    await sharp(out, { raw: { width: w, height: h, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(outputPath + '.tmp');
    fs.renameSync(outputPath + '.tmp', outputPath);
    console.log('Wrote transparent PNG:', outputPath);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
