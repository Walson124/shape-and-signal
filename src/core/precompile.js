// Shader warm-up. Compiling a new material's shader the first time it is drawn
// stalls the frame (sometimes for most of a second). Objects added through
// addCompiled have their shaders compiled in the background first, and only
// appear once they are ready.

let renderer = null;
let camera = null;
let scene = null;
let target = null;
const ready = new Set();

// getTarget returns the render target the scene is really drawn into (the
// post-processing buffer): shaders built for the screen differ from those
// built for a buffer, so compiling against the wrong one does nothing.
export function initPrecompile(r, c, s, getTarget) {
  renderer = r;
  camera = c;
  scene = s;
  target = getTarget;
}

// Add obj to parent once its shaders are compiled. Objects that share a key
// (e.g. every beast of one species) only wait the first time.
export function addCompiled(parent, obj, key = null) {
  if (!renderer || !renderer.compile || (key && ready.has(key))) {
    parent.add(obj);
    return;
  }
  obj.userData.pendingParent = parent;
  const done = () => {
    if (key) ready.add(key);
    if (obj.userData.pendingParent === parent) parent.add(obj);
    obj.userData.pendingParent = null;
  };
  const prev = renderer.getRenderTarget();
  const rt = target && target();
  if (rt) renderer.setRenderTarget(rt);
  let materials;
  try {
    materials = renderer.compile(obj, camera, scene);
  } catch {
    materials = new Set();
  }
  renderer.setRenderTarget(prev);
  // Like three's compileAsync, but a material disposed meanwhile (the object
  // was thrown away) counts as done instead of throwing.
  const check = () => {
    for (const m of materials) {
      const program = renderer.properties.get(m).currentProgram;
      if (!program || program.isReady()) materials.delete(m);
    }
    if (obj.userData.pendingParent !== parent) return; // thrown away
    if (!materials.size) done();
    else setTimeout(check, 16);
  };
  setTimeout(check, 0);
}

// Call when an object is thrown away before it finished compiling.
export function cancelAdd(obj) {
  obj.userData.pendingParent = null;
}
