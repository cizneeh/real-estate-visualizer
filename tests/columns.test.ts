import assert from 'node:assert/strict'
import { test } from 'node:test'
import { animatedHeight, ColumnAnimation, GROW_DURATION } from '../src/columnAnimation'
import { columnMesh, projectVertex, triangleDepth } from '../src/columnGeometry'
import { columnHeight } from '../src/metrics'
import type { PricePoint } from '../src/types'

const point = (id: string, price = 1_000_000): PricePoint => ({
  id,
  price,
  coordinates: [139.767, 35.681],
  address: '東京',
  municipality: '千代田区',
  category: '商業地',
})

test('incremental tiles and reordered points do not restart existing growth', () => {
  const animation = new ColumnAnimation()
  animation.update([point('a')], 'land', 0, true)
  const original = animation.columns[0]
  const halfway = animatedHeight(original, 350)
  assert.ok(halfway > 0 && halfway < original.to)
  animation.update([point('b'), point('a')], 'land', 350, true)
  assert.equal(animatedHeight(animation.columns[1], 350), halfway)
  assert.equal(animatedHeight(animation.columns[0], 350), 0)
  assert.equal(animation.columns[1].started, original.started)
  assert.equal(animation.isAnimating(350), true)
  assert.equal(animation.isAnimating(350 + GROW_DURATION + 81), false)
})

test('year changes interpolate from the previous height through an empty loading state', () => {
  const animation = new ColumnAnimation()
  animation.update([point('a')], 'land', 0, true)
  animation.update([], 'land', 1000, true)
  animation.update([point('a', 4_000_000)], 'land', 1100, true)
  assert.equal(animatedHeight(animation.columns[0], 1100), 900)
  assert.ok(animatedHeight(animation.columns[0], 1450) > 900)
  assert.equal(animatedHeight(animation.columns[0], 1800), 1800)
  animation.update([point('a', 9_000_000)], 'land', 1450, true)
  assert.equal(animation.columns[0].from, 1687.5)
})

test('returning to a cached point keeps its height and datasets do not share transitions', () => {
  const animation = new ColumnAnimation()
  animation.update([point('a')], 'land', 0, true)
  animation.update([], 'land', 1000, true)
  animation.update([point('a')], 'land', 1200, true)
  assert.equal(animatedHeight(animation.columns[0], 1200), 900)
  animation.update([point('a')], 'survey', 1300, true)
  assert.equal(animatedHeight(animation.columns[0], 1300), 0)
  animation.update([{ ...point('a'), change: -5 }], 'survey', 1400, false, 'change')
  assert.equal(animatedHeight(animation.columns[0], 1400), 555)
  animation.update([point('a')], 'land', 1500, true)
  assert.equal(animatedHeight(animation.columns[0], 1500), 900)
})

test('reduced motion and hidden modes settle heights without overshoot', () => {
  const animation = new ColumnAnimation()
  animation.update([point('a')], 'land', 0, false)
  assert.equal(animatedHeight(animation.columns[0], 0), 900)
  animation.grow(50)
  for (let time = 50; time <= 850; time += 10) {
    const height = animatedHeight(animation.columns[0], time)
    assert.ok(height >= 0 && height <= 900)
  }
  animation.finish()
  assert.equal(animation.isAnimating(100), false)
  assert.equal(animatedHeight(animation.columns[0], 100), 900)
  assert.equal(columnHeight(point('max', 100_000_000), 'price'), 6500)
})

test('hexagonal column faces have finite outward normals and flat, level tops', () => {
  const mesh = columnMesh()
  for (let index = 0; index < mesh.length; index += 6) {
    const [x, y, z, nx, ny, nz] = mesh.slice(index, index + 6)
    assert.ok([x, y, z, nx, ny, nz].every(Number.isFinite))
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-6)
    if (nz) assert.equal(z, 1)
    else assert.ok(x * nx + y * ny > 0)
  }
})

test('picking rejects outside triangles and clipped geometry and returns interpolated depth', () => {
  assert.equal(triangleDepth(0, 0, [-1, -1, 0.2], [1, -1, 0.2], [0, 1, 0.2]), 0.2)
  assert.equal(triangleDepth(2, 0, [-1, -1, 0], [1, -1, 0], [0, 1, 0]), undefined)
  assert.equal(triangleDepth(0, 0, [-1, -1, 2], [1, -1, 2], [0, 1, 2]), undefined)
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  assert.deepEqual(projectVertex(identity, [0.2, 0.4, 0.6]), [0.2, 0.4, 0.6])
  identity[15] = -1
  assert.equal(projectVertex(identity, [0, 0, 0]), undefined)
})
