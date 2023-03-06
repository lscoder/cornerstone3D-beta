import cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import {
  RenderingEngine,
  Types,
  Enums,
  volumeLoader,
  utilities as csUtils,
} from '@cornerstonejs/core';
import {
  initDemo,
  createImageIdsAndCacheMetaData,
  setPetTransferFunctionForVolumeActor,
  setTitleAndDescription,
  addButtonToToolbar,
  addSliderToToolbar,
} from '../../../../utils/demo/helpers';
import * as cornerstoneTools from '@cornerstonejs/tools';

// This is for debugging purposes
console.warn(
  'Click on index.ts to open source code for this example --------->'
);

const {
  WindowLevelTool,
  PanTool,
  ZoomTool,
  ToolGroupManager,
  Enums: csToolsEnums,
  utilities: csToolsUtilities,
} = cornerstoneTools;

const { ViewportType } = Enums;
const { MouseBindings } = csToolsEnums;

// ======== Set up page ======== //
setTitleAndDescription('CINE Tool', 'Show the usage of the CINE Tool.');

const content = document.getElementById('content');
const element = document.createElement('div');

// Disable right click context menu so we can have right click tools
element.oncontextmenu = (e) => e.preventDefault();

element.id = 'cornerstone-element';
element.style.width = '500px';
element.style.height = '500px';

content.appendChild(element);

const instructions = document.createElement('p');
instructions.innerText = `
  - Click on Play Clip to start the CINE tool
  - Click on Stop Clip to stop the CINE tool
  - Drag the frame slider to change the frames per second rate
  - Note: as the slices are loading one by one, the first couple of loops will be slower than the rest
`;

content.append(instructions);
// ============================= //

const toolGroupId = 'STACK_TOOL_GROUP_ID';
let framesPerSecond = 1; // 24;

addButtonToToolbar({
  title: 'Play Clip',
  onClick: () => {
    csToolsUtilities.cine.playClip(element, { framesPerSecond });
  },
});

addButtonToToolbar({
  title: 'Stop Clip',
  onClick: () => {
    csToolsUtilities.cine.stopClip(element);
  },
});

addSliderToToolbar({
  title: `Frame per second`,
  range: [1, 100],
  defaultValue: framesPerSecond,
  onSelectedValueChange: (value) => {
    csToolsUtilities.cine.stopClip(element);
    framesPerSecond = Number(value);
    csToolsUtilities.cine.playClip(element, { framesPerSecond });
  },
  updateLabelOnChange: (value, label) => {
    label.innerText = `Frames per second: ${value}`;
  },
});
/**
 * Runs the demo
 */
async function run() {
  const { metaDataManager } = cornerstoneWADOImageLoader.wadors;

  // Init Cornerstone and related libraries
  await initDemo();

  // Add tools to Cornerstone3D
  cornerstoneTools.addTool(WindowLevelTool);
  cornerstoneTools.addTool(PanTool);
  cornerstoneTools.addTool(ZoomTool);

  // Define a tool group, which defines how mouse events map to tool commands for
  // Any viewport using the group
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  // Add the tools to the tool group
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);

  // Set the initial state of the tools, here we set one tool active on left click.
  // This means left click will draw that tool.
  toolGroup.setToolActive(WindowLevelTool.toolName, {
    bindings: [
      {
        mouseButton: MouseBindings.Primary, // Left Click
      },
    ],
  });

  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [
      {
        mouseButton: MouseBindings.Auxiliary,
      },
    ],
  });

  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [
      {
        mouseButton: MouseBindings.Secondary,
      },
    ],
  });

// ====================================================[ 3D VOLUME ]====================================================

//   // Get Cornerstone imageIds and fetch metadata into RAM
//   const imageIds = await createImageIdsAndCacheMetaData({
//     StudyInstanceUID:
//       '1.3.6.1.4.1.14519.5.2.1.7009.2403.334240657131972136850343327463',
//     SeriesInstanceUID:
//       '1.3.6.1.4.1.14519.5.2.1.7009.2403.226151125820845824875394858561',
//     wadoRsRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
//   });

//   // Instantiate a rendering engine
//   const renderingEngineId = 'myRenderingEngine';
//   const renderingEngine = new RenderingEngine(renderingEngineId);

//   // Create a stack viewport
//   const viewportId = 'CT_STACK';
//   const viewportInput = {
//     viewportId,
//     type: ViewportType.ORTHOGRAPHIC, // ViewportType.STACK
//     element,
//     defaultOptions: {
//       orientation: Enums.OrientationAxis.ACQUISITION,
//       background: <Types.Point3>[0.2, 0, 0.2],
//     },
//   };

//   renderingEngine.enableElement(viewportInput);

//   // // Set the tool group on the viewport
//   // toolGroup.addViewport(viewportId, renderingEngineId);

//   // Get the volume viewport that was created
//   const viewport = <Types.IVolumeViewport>(
//     renderingEngine.getViewport(viewportId)
//   );

//   const volumeName = 'CT_VOLUME'; // Id of the volume less loader prefix
//   const volumeLoaderScheme = 'cornerstoneStreamingImageVolume'; // Loader id which defines which volume loader to use
//   const volumeId = `${volumeLoaderScheme}:${volumeName}`; // VolumeId with loader id + volume id

//   // Define a volume in memory
//   const volume = await volumeLoader.createAndCacheVolume(volumeId, {
//     imageIds,
//   });

//   // Set the volume to load
//   volume.load();

//   // Set the volume on the viewport
//   viewport.setVolumes([
//     { volumeId, /* callback: setPetTransferFunctionForVolumeActor */ },
//   ]);

//   window.viewport = viewport;
//   window.volume = volume;

//   // Set the stack on the viewport
//   // viewport.setStack(imageIds);

//   // Render the image
//   viewport.render();
// }

// run();


// ====================================================[ 4D VOLUME ]====================================================

  let imageIds = await createImageIdsAndCacheMetaData({
    StudyInstanceUID:
      '1.3.6.1.4.1.12842.1.1.14.3.20220915.105557.468.2963630849',
    SeriesInstanceUID:
      '1.3.6.1.4.1.12842.1.1.22.4.20220915.124758.560.4125514885',
    wadoRsRoot: 'https://d28o5kq0jsoob5.cloudfront.net/dicomweb',
  });

  imageIds = imageIds.filter((imageId) => {
    const instanceMetaData = metaDataManager.get(imageId);
    const instanceTag = instanceMetaData['00200013'];
    const instanceNumber = parseInt(instanceTag.Value[0]);

    return instanceNumber >= 8696;
  });

  console.log(`A total of ${imageIds.length} will be loaded`);

  // Instantiate a rendering engine
  const renderingEngineId = 'myRenderingEngine';
  const renderingEngine = new RenderingEngine(renderingEngineId);

  // Create a stack viewport
  const viewportId = 'PT_4D_VOLUME';
  const viewportInput = {
    viewportId,
    type: ViewportType.ORTHOGRAPHIC, // ViewportType.STACK
    element,
    defaultOptions: {
      orientation: Enums.OrientationAxis.ACQUISITION,
      background: <Types.Point3>[0.2, 0, 0.2],
    },
  };

  renderingEngine.enableElement(viewportInput);

  // // Set the tool group on the viewport
  // toolGroup.addViewport(viewportId, renderingEngineId);

  // Get the volume viewport that was created
  const viewport = <Types.IVolumeViewport>(
    renderingEngine.getViewport(viewportId)
  );

  const volumeName = 'PT_VOLUME_ID'; // Id of the volume less loader prefix
  const volumeLoaderScheme = 'cornerstoneStreamingDynamicImageVolume'; // Loader id which defines which volume loader to use
  const volumeId = `${volumeLoaderScheme}:${volumeName}`; // VolumeId with loader id + volume id

  // Define a volume in memory
  const volume = await volumeLoader.createAndCacheVolume(volumeId, {
    imageIds,
  });

  // Set the volume to load
  volume.load();

  // Set the volume on the viewport
  viewport.setVolumes([
    { volumeId, callback: setPetTransferFunctionForVolumeActor },
  ]);

  window.viewport = viewport;
  window.volume = volume;

  // Render the image
  viewport.render();
}

run();
