import { generatePlanet, generateRing } from './planetgen.js';
import { buildChunk } from './chunkgen.js';
import { buildVoxelCell } from './voxel.js';

self.onmessage = (e) => {
  const { id, kind, job } = e.data;
  try {
    if (kind === 'ring') {
      const out = generateRing(job);
      self.postMessage({ id, out }, [out.data.buffer]);
    } else if (kind === 'voxel') {
      const out = buildVoxelCell(job);
      self.postMessage({ id, out }, [out.positions.buffer, out.normals.buffer, out.colors.buffer, out.glow.buffer, out.ppos.buffer, out.index.buffer]);
    } else if (kind === 'chunk') {
      const out = buildChunk(job);
      const transfer = [out.positions.buffer, out.normals.buffer, out.colors.buffer, out.glow.buffer, out.ppos.buffer];
      if (out.props) transfer.push(out.props.buffer);
      self.postMessage({ id, out }, transfer);
    } else {
      const out = generatePlanet(job);
      const transfer = [out.color.buffer, out.surface.buffer];
      if (out.emissive) transfer.push(out.emissive.buffer);
      if (out.clouds) transfer.push(out.clouds.buffer);
      self.postMessage({ id, out }, transfer);
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack ? err.stack : err) });
  }
};
