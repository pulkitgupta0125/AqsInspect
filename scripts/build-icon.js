const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const srcPath = path.resolve(__dirname, "../assets/icon.png");
const tempPngPath = path.resolve(__dirname, "../assets/icon-256.png");
const destIcoPath = path.resolve(__dirname, "../assets/icon.ico");

function buildIcon() {
  try {
    if (!fs.existsSync(srcPath)) {
      console.error(`❌ Source icon not found at ${srcPath}`);
      process.exit(1);
    }

    // 1. Resize icon to 256x256 using PowerShell System.Drawing
    console.log("Resizing icon using PowerShell...");
    // Escaping backslashes for PowerShell command argument string
    const escapedSrc = srcPath.replace(/\\/g, "\\\\");
    const escapedDest = tempPngPath.replace(/\\/g, "\\\\");

    const psCommand = `
Add-Type -AssemblyName System.Drawing;
$src = [System.Drawing.Image]::FromFile('${escapedSrc}');
$dest = New-Object System.Drawing.Bitmap(256, 256);
$g = [System.Drawing.Graphics]::FromImage($dest);
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;
$g.DrawImage($src, 0, 0, 256, 256);
$dest.Save('${escapedDest}', [System.Drawing.Imaging.ImageFormat]::Png);
$g.Dispose();
$dest.Dispose();
$src.Dispose();
`.trim().replace(/\r?\n/g, " ");

    execSync(`powershell -NoProfile -Command "${psCommand}"`, { stdio: "inherit" });

    if (!fs.existsSync(tempPngPath)) {
      throw new Error("PowerShell resizing failed to output the temporary 256x256 PNG file.");
    }

    // 2. Read the 256x256 PNG and wrap it in ICO format
    console.log("Packaging resized PNG into ICO format...");
    const pngBuffer = fs.readFileSync(tempPngPath);

    const icoBuffer = Buffer.alloc(22 + pngBuffer.length);

    // ICO Header (6 bytes)
    icoBuffer.writeUInt16LE(0, 0);      // Reserved
    icoBuffer.writeUInt16LE(1, 2);      // Resource Type (1 = ICO)
    icoBuffer.writeUInt16LE(1, 4);      // Number of Images (1)

    // Directory Entry (16 bytes)
    icoBuffer.writeUInt8(0, 6);         // Width (0 means 256)
    icoBuffer.writeUInt8(0, 7);         // Height (0 means 256)
    icoBuffer.writeUInt8(0, 8);         // Color Palette (0 = no palette)
    icoBuffer.writeUInt8(0, 9);         // Reserved
    icoBuffer.writeUInt16LE(1, 10);     // Color Planes (1)
    icoBuffer.writeUInt16LE(32, 12);    // Bits per pixel (32)
    icoBuffer.writeUInt32LE(pngBuffer.length, 14); // Size of PNG data in bytes
    icoBuffer.writeUInt32LE(22, 18);    // Offset of PNG data (header + entry = 22)

    // Copy PNG data
    pngBuffer.copy(icoBuffer, 22);

    // Write to final destination
    fs.writeFileSync(destIcoPath, icoBuffer);
    console.log(`✅ Success! ICO file created at: ${destIcoPath}`);

    // Cleanup temporary PNG
    if (fs.existsSync(tempPngPath)) {
      fs.unlinkSync(tempPngPath);
    }
  } catch (err) {
    console.error("❌ Failed to build icon:", err.message);
    process.exit(1);
  }
}

buildIcon();
