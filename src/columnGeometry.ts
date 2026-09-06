export type Vec3 = [number, number, number]

// The original regular hexagonal footprint, shared by rendering and picking.
export const COLUMN_RING: [number, number][] = Array.from({ length: 6 }, (_, index) => {
  const angle = (index * Math.PI) / 3
  return [Math.cos(angle), Math.sin(angle)]
})

export const COLUMN_VERTICES: Vec3[] = [
  ...COLUMN_RING.map(([x, y]): Vec3 => [x, y, 0]),
  ...COLUMN_RING.map(([x, y]): Vec3 => [x, y, 1]),
  [0, 0, 1],
]

export const COLUMN_TRIANGLES: [number, number, number][] = COLUMN_RING.flatMap((_, index) => {
  const next = (index + 1) % COLUMN_RING.length
  const top = index + COLUMN_RING.length
  const nextTop = next + COLUMN_RING.length
  return [
    [index, next, nextTop],
    [index, nextTop, top],
    [COLUMN_RING.length * 2, top, nextTop],
  ] as [number, number, number][]
})

export function columnMesh() {
  return new Float32Array(
    COLUMN_TRIANGLES.flatMap((triangle) => {
      const [a, b, c] = triangle.map((index) => COLUMN_VERTICES[index])
      const normal: Vec3 =
        a[2] === 1 && b[2] === 1 && c[2] === 1 ? [0, 0, 1] : [b[1] - a[1], a[0] - b[0], 0]
      const length = Math.hypot(...normal)
      return [a, b, c].flatMap((vertex) => [...vertex, ...normal.map((value) => value / length)])
    }),
  )
}

export function projectVertex(matrix: ArrayLike<number>, [x, y, z]: Vec3): Vec3 | undefined {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]
  if (w <= 0) return undefined
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ]
}

export function triangleDepth(x: number, y: number, a: Vec3, b: Vec3, c: Vec3) {
  const area = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
  if (Math.abs(area) < 1e-12) return undefined
  const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / area
  const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / area
  if (u < 0 || v < 0 || u + v > 1) return undefined
  const depth = u * a[2] + v * b[2] + (1 - u - v) * c[2]
  return depth >= -1 && depth <= 1 ? depth : undefined
}
