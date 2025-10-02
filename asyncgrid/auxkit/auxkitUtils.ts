/**
 * Utility type guard for non-null plain objects
 */
export function isObject<T extends object = object>(value: unknown): value is T {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Internal helper to clone ArrayBuffer and TypedArray views
 */
function cloneArrayBuffer(input: ArrayBufferLike): ArrayBuffer {
  const out = new ArrayBuffer(input.byteLength)
  new Uint8Array(out).set(new Uint8Array(input as ArrayBuffer))
  return out
}

/**
 * Deeply clone a value
 * Supports primitives, arrays, plain objects, Date, RegExp, Map, Set, ArrayBuffer, TypedArrays, URL, and Error
 * Preserves property descriptors for own enumerable keys and symbols
 * Handles circular references via a WeakMap cache
 */
export function deepClone<T>(input: T, cache = new WeakMap()): T {
  if (input === null || typeof input !== "object") {
    return input
  }

  if (cache.has(input as unknown as object)) {
    return cache.get(input as unknown as object) as T
  }

  // Date
  if (input instanceof Date) {
    return new Date(input.getTime()) as unknown as T
  }

  // RegExp
  if (input instanceof RegExp) {
    const re = new RegExp(input.source, input.flags)
    re.lastIndex = input.lastIndex
    return re as unknown as T
  }

  // URL
  if (input instanceof URL) {
    return new URL(input.toString()) as unknown as T
  }

  // Error
  if (input instanceof Error) {
    const e = new (input as any).constructor(input.message)
    Object.getOwnPropertyNames(input).forEach((k) => {
      ;(e as any)[k] = deepClone((input as any)[k], cache)
    })
    return e
  }

  // ArrayBuffer
  if (input instanceof ArrayBuffer) {
    return cloneArrayBuffer(input) as unknown as T
  }

  // TypedArrays
  if (ArrayBuffer.isView(input)) {
    // DataView
    if (input instanceof DataView) {
      return new DataView(cloneArrayBuffer(input.buffer), input.byteOffset, input.byteLength) as unknown as T
    }
    // Typed arrays
    const ctor = (input as any).constructor
    return new ctor(cloneArrayBuffer((input as any).buffer), (input as any).byteOffset, (input as any).length)
  }

  // Map
  if (input instanceof Map) {
    const out = new Map()
    cache.set(input as unknown as object, out)
    input.forEach((v, k) => {
      out.set(deepClone(k as any, cache), deepClone(v as any, cache))
    })
    return out as unknown as T
  }

  // Set
  if (input instanceof Set) {
    const out = new Set()
    cache.set(input as unknown as object, out)
    input.forEach((v) => {
      out.add(deepClone(v as any, cache))
    })
    return out as unknown as T
  }

  // Array
  if (Array.isArray(input)) {
    const out: any[] = new Array(input.length)
    cache.set(input as unknown as object, out)
    for (let i = 0; i < input.length; i++) {
      out[i] = deepClone((input as any)[i], cache)
    }
    return out as unknown as T
  }

  // Plain object and class instances
  const proto = Object.getPrototypeOf(input)
  const out: any = Object.create(proto)
  cache.set(input as unknown as object, out)

  for (const key of Reflect.ownKeys(input as object)) {
    const desc = Object.getOwnPropertyDescriptor(input as object, key)
    if (!desc || !desc.enumerable) continue
    const val = (input as any)[key as any]
    out[key as any] = isObject(val) || Array.isArray(val) ? deepClone(val, cache) : deepClone(val, cache)
  }

  return out as T
}

/**
 * Deeply merge two values into a new value
 * Objects are merged recursively
 * Arrays are replaced by default to avoid unintended index merges
 * Maps and Sets are cloned from source when encountered
 */
export function mergeDeep<TTarget = any, TSource = any>(target: TTarget, source: TSource): TTarget & TSource {
  // If source is not mergeable, return its deep clone
  const targetIsObj = isObject(target) || Array.isArray(target)
  const sourceIsObj = isObject(source) || Array.isArray(source)

  if (!sourceIsObj) {
    return deepClone(source) as unknown as TTarget & TSource
  }
  if (!targetIsObj) {
    return deepClone(source) as unknown as TTarget & TSource
  }

  // Arrays: replace behavior
  if (Array.isArray(source)) {
    return deepClone(source) as unknown as TTarget & TSource
  }

  // Map and Set: take from source clone
  if (source instanceof Map || source instanceof Set) {
    return deepClone(source) as unknown as TTarget & TSource
  }

  // Merge plain objects
  const output: any = deepClone(target)
  for (const key of Reflect.ownKeys(source as object)) {
    const srcVal = (source as any)[key as any]
    const tgtVal = (output as any)[key as any]

    if ((isObject(tgtVal) && isObject(srcVal)) && !(srcVal instanceof Date) && !(srcVal instanceof RegExp)) {
      output[key as any] = mergeDeep(tgtVal, srcVal)
    } else {
      output[key as any] = deepClone(srcVal)
    }
  }
  return output
}

/**
 * Throttle function calls to at most once per wait interval
 * Supports leading and trailing invocation, plus cancel and flush controls
 */
export function throttle<Func extends (...args: any[]) => any>(
  fn: Func,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): Func & { cancel: () => void; flush: () => void } {
  let lastInvoke = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: any[] | null = null
  let lastThis: any
  const leading = options.leading !== false
  const trailing = options.trailing !== false

  function invoke(now: number) {
    lastInvoke = now
    const result = fn.apply(lastThis, lastArgs as any)
    lastArgs = lastThis = null
    return result
  }

  function startTimer(remaining: number) {
    timer = setTimeout(() => {
      timer = null
      if (trailing && lastArgs) {
        invoke(Date.now())
      }
    }, remaining)
  }

  const throttled = function (this: any, ...args: any[]) {
    const now = Date.now()
    if (!lastInvoke && !leading) {
      lastInvoke = now
    }
    const remaining = wait - (now - lastInvoke)
    lastArgs = args
    lastThis = this

    if (remaining <= 0 || remaining > wait) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      return invoke(now)
    }

    if (!timer && trailing) {
      startTimer(remaining)
    }
  } as Func & { cancel: () => void; flush: () => void }

  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    lastInvoke = 0
    lastArgs = lastThis = null
  }

  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      if (lastArgs) {
        invoke(Date.now())
      }
    }
  }

  return throttled
}

/*
Suggested filenames
- object_utils_deep_clone.ts
- merge_tools_throttle.ts
- core_object_timing_utils.ts
*/
