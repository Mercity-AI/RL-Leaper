import { rustPlatePixels } from './rustPlate.js';

// Makes the scrap sign's rusty sheet off the main thread (about half a second
// of maths), so the game never stutters for it.
self.onmessage = ({ data }) => {
  const plate = rustPlatePixels(data);
  self.postMessage(plate, [plate.pixels.buffer, plate.rust.buffer]);
};
