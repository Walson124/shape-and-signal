import { generatePlanet, generateRing } from './planetgen.js';

self.onmessage = (e) => {
  const { id, kind, job } = e.data;
  try {
    if (kind === 'ring') {
      const out = generateRing(job);
      self.postMessage({ id, out }, [out.data.buffer]);
    } else {
      const out = generatePlanet(job);
      const transfer = [out.color.buffer, out.surface.buffer];
      if (out.emissive) transfer.push(out.emissive.buffer);
      if (out.clouds) transfer.push(out.clouds.buffer);
      self.postMessage({ id, out }, transfer);
    }
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
