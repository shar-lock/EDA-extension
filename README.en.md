[简体中文](./README.md) | [English](#) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

# Silkscreen Fill

JLCEDA Pro extension: Use clipper.js to perform boolean operations on the silkscreen layer and generate fill regions in the PCB editor.

## Introduction

This plugin aims to solve the problem of complex boolean operations on the PCB silkscreen layer. By using the high-performance polygon operation library **clipper.js**, users can easily generate fill regions on the silkscreen layer that avoid existing silkscreen primitives.

### Key Features

- **High-Precision Boolean Operations**: Uses `clipper.js` for stable Difference, Union, and Intersection operations.
- **Multi-Primitive Support**: Supports Line, Arc, Polyline, Fill, and String primitives on the silkscreen layer.
- **Smart Interaction**: Supports rectangular selection on the canvas, automatically calculating the bounding box (BBox) of all silkscreen primitives within the area for deduction.
- **JLCEDA Pro API Compatibility**: Fully adapted to the JLCEDA Pro extension API.

## Usage

1. **Start the Extension**: Find **Silkscreen Tools -> Silkscreen Fill** in the top menu bar of the PCB editor.
2. **Select Area**: Click and drag on the canvas to make a rectangular selection of the area you want to process.
3. **Automatic Generation**: The plugin will automatically extract the silkscreen primitives in the area, calculate the difference between the selection and the primitives, and generate a fill region on the top silkscreen layer.

## Development & Compilation

If you wish to develop based on this project:

1. **Install Dependencies**

    ```shell
    npm install
    ```

2. **Compile Project**

    ```shell
    npm run build
    ```

3. **Install Extension**: In JLCEDA Pro, go to "Extension Settings" -> "Import", and select the compiled `./build/dist/` directory.

## Tech Stack

- [Clipper.js](https://github.com/Doodle3D/clipper-js) - Polygon boolean operation engine
- [@jlceda/pro-api-types](https://www.npmjs.com/package/@jlceda/pro-api-types) - JLCEDA Pro API type definitions
- TypeScript & esbuild

## License

This project is licensed under the [Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/).
