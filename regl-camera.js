export function createCamera(regl, props = {}) {
  // Preserve backward-compatibilty while renaming preventDefault -> noScroll
  if (typeof props.noScroll === "undefined") {
    props.noScroll = props.preventDefault;
  }

  var cameraState = {
    view: identity(new Float32Array(16)),
    projection: identity(new Float32Array(16)),
    center: new Float32Array(props.center || 3),
    theta: props.theta || 0,
    phi: props.phi || 0,
    distance: Math.log(props.distance || 10.0),
    eye: new Float32Array(3),
    up: new Float32Array(props.up || [0, 1, 0]),
    right: new Float32Array(props.right || [1, 0, 0]),
    front: new Float32Array(props.front || [0, 0, 1]),
    fovy: props.fovy || Math.PI / 4.0,
    near: typeof props.near !== "undefined" ? props.near : 0.01,
    far: typeof props.far !== "undefined" ? props.far : 1000.0,
    noScroll: typeof props.noScroll !== "undefined" ? props.noScroll : false,
    flipY: !!props.flipY,
    dtheta: 0,
    dphi: 0,
    rotationSpeed:
      typeof props.rotationSpeed !== "undefined" ? props.rotationSpeed : 1,
    zoomSpeed: typeof props.zoomSpeed !== "undefined" ? props.zoomSpeed : 1,
    renderOnDirty:
      typeof props.renderOnDirty !== undefined ? !!props.renderOnDirty : false,
  };

  var element = props.element;
  var damping = typeof props.damping !== "undefined" ? props.damping : 0.9;

  var minDistance = Math.log("minDistance" in props ? props.minDistance : 0.1);
  var maxDistance = Math.log("maxDistance" in props ? props.maxDistance : 1000);

  var ddistance = 0;

  if (props.mouse !== false) {
    var source = element || regl._gl.canvas;

    function getWidth() {
      return element ? element.offsetWidth : window.innerWidth;
    }

    function getHeight() {
      return element ? element.offsetHeight : window.innerHeight;
    }

    source.addEventListener("mousemove", (ev) => {
      if (ev.buttons & 1) {
        const dx = ev.movementX / getWidth();
        const dy = ev.movementY / getHeight();

        cameraState.dtheta += cameraState.rotationSpeed * 4.0 * dx;
        cameraState.dphi += cameraState.rotationSpeed * 4.0 * dy;
        cameraState.dirty = true;
      }
    });

    if (!props.noScroll) {
      source.addEventListener("wheel", (ev) => {
        ddistance += (ev.deltaY / getHeight()) * cameraState.zoomSpeed;
        cameraState.dirty = true;
      });
    }
  }

  function damp(x) {
    var xd = x * damping;
    if (Math.abs(xd) < 0.1) {
      return 0;
    }
    cameraState.dirty = true;
    return xd;
  }

  function clamp(x, lo, hi) {
    return Math.min(Math.max(x, lo), hi);
  }

  function updateCamera(props) {
    Object.keys(props).forEach(function (prop) {
      cameraState[prop] = props[prop];
    });

    var center = cameraState.center;
    var eye = cameraState.eye;
    var up = cameraState.up;
    var right = cameraState.right;
    var front = cameraState.front;
    var dtheta = cameraState.dtheta;
    var dphi = cameraState.dphi;

    cameraState.theta += dtheta;
    cameraState.phi = clamp(
      cameraState.phi + dphi,
      -Math.PI / 2.0,
      Math.PI / 2.0
    );
    cameraState.distance = clamp(
      cameraState.distance + ddistance,
      minDistance,
      maxDistance
    );

    cameraState.dtheta = damp(dtheta);
    cameraState.dphi = damp(dphi);
    ddistance = damp(ddistance);

    var theta = cameraState.theta;
    var phi = cameraState.phi;
    var r = Math.exp(cameraState.distance);

    var vf = r * Math.sin(theta) * Math.cos(phi);
    var vr = r * Math.cos(theta) * Math.cos(phi);
    var vu = r * Math.sin(phi);

    for (var i = 0; i < 3; ++i) {
      eye[i] = center[i] + vf * front[i] + vr * right[i] + vu * up[i];
    }

    lookAt(cameraState.view, eye, center, up);
  }

  cameraState.dirty = true;

  var injectContext = regl({
    context: {
      ...cameraState,
      dirty: function () {
        return cameraState.dirty;
      },
      projection: function (context) {
        perspective(
          cameraState.projection,
          cameraState.fovy,
          context.viewportWidth / context.viewportHeight,
          cameraState.near,
          cameraState.far
        );
        if (cameraState.flipY) {
          cameraState.projection[5] *= -1;
        }
        return cameraState.projection;
      },
    },
    uniforms: Object.keys(cameraState).reduce(function (uniforms, name) {
      uniforms[name] = regl.context(name);
      return uniforms;
    }, {}),
  });

  function setupCamera(props, block) {
    if (typeof setupCamera.dirty !== "undefined") {
      cameraState.dirty = setupCamera.dirty || cameraState.dirty;
      setupCamera.dirty = undefined;
    }

    if (props && block) {
      cameraState.dirty = true;
    }

    if (cameraState.renderOnDirty && !cameraState.dirty) return;

    if (!block) {
      block = props;
      props = {};
    }

    updateCamera(props);
    injectContext(block);
    cameraState.dirty = false;
  }

  Object.keys(cameraState).forEach(function (name) {
    setupCamera[name] = cameraState[name];
  });

  return setupCamera;
}

/**
 * Set a mat4 to the identity matrix
 *
 * @param {mat4} out the receiving matrix
 * @returns {mat4} out
 */
function identity(out) {
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = 1;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
};

/**
 * Generates a perspective projection matrix with the given bounds
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {number} fovy Vertical field of view in radians
 * @param {number} aspect Aspect ratio. typically viewport width/height
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum
 * @returns {mat4} out
 */
function perspective(out, fovy, aspect, near, far) {
  var f = 1.0 / Math.tan(fovy / 2),
      nf = 1 / (near - far);
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = (2 * far * near) * nf;
  out[15] = 0;
  return out;
};

/**
 * Generates a look-at matrix with the given eye position, focal point, and up axis
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {vec3} eye Position of the viewer
 * @param {vec3} center Point the viewer is looking at
 * @param {vec3} up vec3 pointing up
 * @returns {mat4} out
 */
function lookAt(out, eye, center, up) {
  var x0, x1, x2, y0, y1, y2, z0, z1, z2, len,
      eyex = eye[0],
      eyey = eye[1],
      eyez = eye[2],
      upx = up[0],
      upy = up[1],
      upz = up[2],
      centerx = center[0],
      centery = center[1],
      centerz = center[2];

  if (Math.abs(eyex - centerx) < 0.000001 &&
      Math.abs(eyey - centery) < 0.000001 &&
      Math.abs(eyez - centerz) < 0.000001) {
      return identity(out);
  }

  z0 = eyex - centerx;
  z1 = eyey - centery;
  z2 = eyez - centerz;

  len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
  z0 *= len;
  z1 *= len;
  z2 *= len;

  x0 = upy * z2 - upz * z1;
  x1 = upz * z0 - upx * z2;
  x2 = upx * z1 - upy * z0;
  len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
  if (!len) {
      x0 = 0;
      x1 = 0;
      x2 = 0;
  } else {
      len = 1 / len;
      x0 *= len;
      x1 *= len;
      x2 *= len;
  }

  y0 = z1 * x2 - z2 * x1;
  y1 = z2 * x0 - z0 * x2;
  y2 = z0 * x1 - z1 * x0;

  len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
  if (!len) {
      y0 = 0;
      y1 = 0;
      y2 = 0;
  } else {
      len = 1 / len;
      y0 *= len;
      y1 *= len;
      y2 *= len;
  }

  out[0] = x0;
  out[1] = y0;
  out[2] = z0;
  out[3] = 0;
  out[4] = x1;
  out[5] = y1;
  out[6] = z1;
  out[7] = 0;
  out[8] = x2;
  out[9] = y2;
  out[10] = z2;
  out[11] = 0;
  out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
  out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
  out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
  out[15] = 1;

  return out;
};