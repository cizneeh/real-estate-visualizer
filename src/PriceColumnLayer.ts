import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap,
  MercatorCoordinate,
} from 'maplibre-gl'
import { animatedHeight, ColumnAnimation } from './columnAnimation'
import {
  COLUMN_TRIANGLES,
  COLUMN_VERTICES,
  columnMesh,
  projectVertex,
  triangleDepth,
  type Vec3,
} from './columnGeometry'
import { colorFor } from './metrics'
import type { Dataset, PricePoint } from './types'

const ORIGIN = MercatorCoordinate.fromLngLat([138, 36])
const STRIDE = 9
const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_vertex;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_center;
layout(location = 3) in float a_scale;
layout(location = 4) in float a_height;
layout(location = 5) in float a_radius;
layout(location = 6) in vec3 a_color;
layout(location = 7) in float a_active;
uniform mat4 u_matrix;
out vec4 v_color;
void main() {
  vec4 base = u_matrix * vec4(a_center, 0.0, 1.0);
  float distance = length(base.xy / base.w);
  float opacity = mix(1.0 - 0.7 * smoothstep(0.22, 1.05, distance), 1.0, a_active);
  vec3 position = vec3(a_center + a_vertex.xy * a_radius * a_scale, a_vertex.z * a_height * a_scale);
  gl_Position = u_matrix * vec4(position, 1.0);
  float sideLight = 0.86 + 0.07 * dot(a_normal.xy, normalize(vec2(-0.6, -0.8))) + 0.04 * a_vertex.z;
  vec3 color = a_normal.z > 0.5 ? mix(a_color, vec3(1.0), 0.15) : a_color * sideLight;
  color = mix(color, mix(a_color, vec3(1.0), 0.48), a_active * 0.85);
  v_color = vec4(color * opacity, opacity);
}`
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }
`

interface RenderedColumn {
  point: PricePoint
  x: number
  y: number
  scale: number
  height: number
  radius: number
  depth: number
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create the column shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Could not compile the column shader'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

export class PriceColumnLayer implements CustomLayerInterface {
  readonly id = 'price-columns'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const
  private map?: LibreMap
  private program?: WebGLProgram
  private vao?: WebGLVertexArrayObject
  private meshBuffer?: WebGLBuffer
  private instanceBuffer?: WebGLBuffer
  private matrixUniform?: WebGLUniformLocation
  private matrix?: Float32Array
  private animation = new ColumnAnimation()
  private dataset: Dataset = 'land'
  private visible = false
  private selectedId?: string
  private hoveredId?: string
  private highlights = new Map<string, { from: number; to: number; started: number }>()
  private rendered: RenderedColumn[] = []
  private motion?: MediaQueryList
  private instances = new Float32Array(0)
  private readonly mesh = columnMesh()
  private onMotionChange = () => {
    if (this.motion?.matches) this.animation.finish()
    this.map?.triggerRepaint()
  }

  onAdd(map: LibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.initialize(gl)
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.motion.addEventListener('change', this.onMotionChange)
  }

  private initialize(gl: WebGL2RenderingContext) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('Could not create the column program')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? 'Could not link the column program'
      gl.deleteProgram(program)
      throw new Error(message)
    }
    this.program = program
    this.matrixUniform = gl.getUniformLocation(program, 'u_matrix') ?? undefined
    this.vao = gl.createVertexArray() ?? undefined
    this.meshBuffer = gl.createBuffer() ?? undefined
    this.instanceBuffer = gl.createBuffer() ?? undefined
    gl.bindVertexArray(this.vao ?? null)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer ?? null)
    gl.bufferData(gl.ARRAY_BUFFER, this.mesh, gl.STATIC_DRAW)
    for (let index = 0; index < 2; index++) {
      gl.enableVertexAttribArray(index)
      gl.vertexAttribPointer(index, 3, gl.FLOAT, false, 24, index * 12)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer ?? null)
    let offset = 0
    for (const [index, size] of [2, 1, 1, 1, 3, 1].entries()) {
      gl.enableVertexAttribArray(index + 2)
      gl.vertexAttribPointer(index + 2, size, gl.FLOAT, false, STRIDE * 4, offset * 4)
      gl.vertexAttribDivisor(index + 2, 1)
      offset += size
    }
    gl.bindVertexArray(null)
  }

  setData(points: PricePoint[], dataset: Dataset) {
    this.dataset = dataset
    this.animation.update(points, dataset, performance.now(), this.visible && !this.motion?.matches)
    this.map?.triggerRepaint()
  }

  setVisible(visible: boolean) {
    if (visible === this.visible) return
    this.visible = visible
    if (visible && !this.motion?.matches) this.animation.grow(performance.now())
    else this.animation.finish()
    this.map?.triggerRepaint()
  }

  setSelected(id?: string) {
    if (this.selectedId === id) return
    this.selectedId = id
    this.updateHighlights()
    this.map?.triggerRepaint()
  }

  setHovered(id?: string) {
    if (this.hoveredId === id) return
    this.hoveredId = id
    this.updateHighlights()
    this.map?.triggerRepaint()
  }

  private highlightAt(id: string, now: number) {
    const highlight = this.highlights.get(id)
    if (!highlight) return 0
    const progress = this.motion?.matches
      ? 1
      : Math.min(1, Math.max(0, (now - highlight.started) / 160))
    return highlight.from + (highlight.to - highlight.from) * (1 - (1 - progress) ** 3)
  }

  private updateHighlights() {
    const now = performance.now()
    const ids = new Set([...this.highlights.keys(), this.selectedId, this.hoveredId])
    for (const id of ids) {
      if (!id) continue
      const to = id === this.selectedId || id === this.hoveredId ? 1 : 0
      if (this.highlights.get(id)?.to === to) continue
      this.highlights.set(id, { from: this.highlightAt(id, now), to, started: now })
    }
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (!this.visible || !this.program || !this.vao || !this.map) {
      this.rendered = []
      return
    }
    const now = performance.now()
    const source = options.defaultProjectionData.mainMatrix
    const matrix = new Float32Array(source)
    // Subtract a local origin before conversion to float32 to avoid jitter at street zooms.
    for (let row = 0; row < 4; row++) {
      matrix[12 + row] = source[12 + row] + source[row] * ORIGIN.x + source[4 + row] * ORIGIN.y
    }
    this.matrix = matrix
    this.rendered = this.animation.columns
      .map((column) => {
        const position = MercatorCoordinate.fromLngLat(column.point.coordinates)
        const x = position.x - ORIGIN.x
        const y = position.y - ORIGIN.y
        return {
          point: column.point,
          x,
          y,
          scale: position.meterInMercatorCoordinateUnits(),
          radius: column.point.count ? 85 : 45,
          height: animatedHeight(column, now),
          depth: matrix[3] * x + matrix[7] * y + matrix[15],
        }
      })
      .sort((a, b) => b.depth - a.depth)
    if (this.instances.length !== this.rendered.length * STRIDE) {
      this.instances = new Float32Array(this.rendered.length * STRIDE)
    }
    for (const [index, column] of this.rendered.entries()) {
      const color = colorFor(column.point, this.dataset)
      this.instances.set(
        [
          column.x,
          column.y,
          column.scale,
          column.height,
          column.radius,
          Number.parseInt(color.slice(1, 3), 16) / 255,
          Number.parseInt(color.slice(3, 5), 16) / 255,
          Number.parseInt(color.slice(5, 7), 16) / 255,
          this.highlightAt(column.point.id, now),
        ],
        index * STRIDE,
      )
    }
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL useProgram is not a React hook.
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.uniformMatrix4fv(this.matrixUniform ?? null, false, matrix)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer ?? null)
    gl.bufferData(gl.ARRAY_BUFFER, this.instances, gl.DYNAMIC_DRAW)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(false)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    // Mercator's south-positive Y axis reverses the mesh winding on screen.
    gl.frontFace(gl.CW)
    // Back-to-front instances with front faces only prevent translucent faces from stacking within one column.
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.mesh.length / 6, this.rendered.length)
    gl.bindVertexArray(null)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)
    gl.frontFace(gl.CCW)
    let highlighting = false
    for (const [id, highlight] of this.highlights) {
      if (!this.motion?.matches && now < highlight.started + 160) highlighting = true
      else if (highlight.to === 0) this.highlights.delete(id)
    }
    if (this.animation.isAnimating(now) || highlighting) this.map.triggerRepaint()
  }

  pick(screen: { x: number; y: number }): PricePoint | undefined {
    if (!this.visible || !this.matrix || !this.map) return undefined
    const canvas = this.map.getCanvas()
    const x = (screen.x / canvas.clientWidth) * 2 - 1
    const y = 1 - (screen.y / canvas.clientHeight) * 2
    let closest = Number.POSITIVE_INFINITY
    let picked: PricePoint | undefined
    for (const column of this.rendered) {
      const vertices = COLUMN_VERTICES.map(([vx, vy, vz]) =>
        projectVertex(this.matrix as Float32Array, [
          column.x + vx * column.radius * column.scale,
          column.y + vy * column.radius * column.scale,
          vz * column.height * column.scale,
        ]),
      )
      const visible = vertices.filter((vertex): vertex is Vec3 => vertex !== undefined)
      if (
        !visible.length ||
        x < Math.min(...visible.map((p) => p[0])) ||
        x > Math.max(...visible.map((p) => p[0])) ||
        y < Math.min(...visible.map((p) => p[1])) ||
        y > Math.max(...visible.map((p) => p[1]))
      )
        continue
      for (const triangle of COLUMN_TRIANGLES) {
        const [a, b, c] = triangle.map((index) => vertices[index])
        if (!a || !b || !c) continue
        const depth = triangleDepth(x, y, a, b, c)
        if (depth !== undefined && depth < closest) {
          closest = depth
          picked = column.point
        }
      }
    }
    return picked
  }

  onRemove(_map: LibreMap, gl: WebGL2RenderingContext) {
    this.motion?.removeEventListener('change', this.onMotionChange)
    if (this.program) gl.deleteProgram(this.program)
    if (this.vao) gl.deleteVertexArray(this.vao)
    if (this.meshBuffer) gl.deleteBuffer(this.meshBuffer)
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer)
    this.rendered = []
    this.matrix = undefined
    this.map = undefined
  }
}
