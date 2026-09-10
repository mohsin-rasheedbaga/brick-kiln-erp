# Build Resources

Place the following files here before building the Windows installer:

- `icon.ico` — Windows application icon (256×256 multi-resolution ICO)
- `icon.png` — PNG version for Linux/Electron window icon (512×512)

## Generating icons from a source image

If you have a source PNG (e.g. `icon-source.png`, 1024×1024):

```bash
# Install icon generator tools
npm install -g electron-icon-builder

# Generate all required icon formats
electron-icon-builder --input=icon-source.png --output=build-resources
```

This will create:
- `build-resources/icons/icon.ico` (Windows)
- `build-resources/icons/png/512x512.png` (move to icon.png)

For Phase 1, electron-builder will use a default Electron icon if no icon is provided.
