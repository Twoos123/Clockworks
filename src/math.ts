// Minimal column-major 4x4 matrix and quaternion helpers (WebGL conventions). Clyde's
// Matrix4f names elements by (column, row), so its stream order is row-major; see readTransform.

export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const identity = (): Mat4 => {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

export function multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
    }
  }
  return out;
}

/** Translation, rotation and uniform scale composed as T * R * S. */
export function compose(t: Vec3, q: Quat, s: number, out: Mat4 = new Float32Array(16)): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * s; out[1] = (xy + wz) * s; out[2] = (xz - wy) * s; out[3] = 0;
  out[4] = (xy - wz) * s; out[5] = (1 - (xx + zz)) * s; out[6] = (yz + wx) * s; out[7] = 0;
  out[8] = (xz + wy) * s; out[9] = (yz - wx) * s; out[10] = (1 - (xx + yy)) * s; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}

export function invert(m: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  const a = m;
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
  const b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
  const b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return identity();
  det = 1 / det;
  out[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
  out[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
  out[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
  out[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  out[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
  out[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  out[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
  out[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  out[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
  out[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
  out[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
  out[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  out[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
  out[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  out[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
  out[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return out;
}

export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[4] = xy; m[5] = yy; m[6] = zy; m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0: number, s1: number;
  if (1 - cos > 1e-4) {
    const ang = Math.acos(cos), sin = Math.sin(ang);
    s0 = Math.sin((1 - t) * ang) / sin; s1 = Math.sin(t * ang) / sin;
  } else { s0 = 1 - t; s1 = t; }
  return [s0 * a[0] + s1 * bx, s0 * a[1] + s1 * by, s0 * a[2] + s1 * bz, s0 * a[3] + s1 * bw];
}

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A decoded Clyde Transform3D. Either TRS (rigid/uniform) or a full matrix (affine). */
export interface Transform {
  t: Vec3;
  r: Quat;
  s: number;
  matrix?: Mat4;
}

export const IDENTITY_TRANSFORM: Transform = { t: [0, 0, 0], r: [0, 0, 0, 1], s: 1 };

/** Decodes an imported com.threerings.math.Transform3D object (see Transform3D.readFields). */
export function readTransform(o: any): Transform {
  if (!o) return IDENTITY_TRANSFORM;
  if (o.matrix) {
    const m = o.matrix;
    // Clyde names elements mCR (column, row): translation lives in m30, m31, m32.
    return { ...IDENTITY_TRANSFORM, matrix: new Float32Array([
      m.m00, m.m01, m.m02, m.m03, m.m10, m.m11, m.m12, m.m13,
      m.m20, m.m21, m.m22, m.m23, m.m30, m.m31, m.m32, m.m33]) };
  }
  const t: Vec3 = o.translation ? [o.translation.x, o.translation.y, o.translation.z] : [0, 0, 0];
  const r: Quat = o.rotation ? [o.rotation.x, o.rotation.y, o.rotation.z, o.rotation.w] : [0, 0, 0, 1];
  return { t, r, s: typeof o.scale === "number" ? o.scale : 1 };
}

export const toMatrix = (x: Transform, out?: Mat4): Mat4 =>
  x.matrix ? (out ? (out.set(x.matrix), out) : x.matrix.slice()) : compose(x.t, x.r, x.s, out);
