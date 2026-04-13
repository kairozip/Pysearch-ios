/**
 * Embed PySearch mascot into PySearch.exe without electron-builder's rcedit step.
 *
 * `signAndEditExecutable: false` avoids winCodeSign (7-Zip symlink extraction fails
 * without Developer Mode / admin). That also skips the normal icon embedding, so we
 * run node-rcedit here; it ships `rcedit-x64.exe` and does not need winCodeSign.
 */
const path = require('path');
const fs = require('fs');

module.exports = async function afterPackWinIcon(context) {
    if (context.electronPlatformName !== 'win32') return;

    const rcedit = require('rcedit');
    const { appOutDir } = context;
    const appInfo = context.packager.appInfo;
    const projectDir = context.packager.projectDir;

    const exe = path.join(appOutDir, `${appInfo.productFilename}.exe`);
    const iconPath = path.join(projectDir, 'assets', 'icon.ico');

    if (!fs.existsSync(exe)) {
        throw new Error(`after-pack-win-icon: missing ${exe}`);
    }
    if (!fs.existsSync(iconPath)) {
        throw new Error(`after-pack-win-icon: run "npm run icons" first — missing ${iconPath}`);
    }

    const internal = path.basename(appInfo.productFilename);
    await rcedit(exe, {
        icon: iconPath,
        'file-version': appInfo.shortVersion || appInfo.buildVersion,
        'product-version': appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm(),
        'version-string': {
            FileDescription: appInfo.productName,
            ProductName: appInfo.productName,
            LegalCopyright: appInfo.copyright,
            InternalName: internal,
            OriginalFilename: '',
        },
    });
};
