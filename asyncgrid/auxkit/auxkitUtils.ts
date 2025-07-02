
export function deepClone<T>(input: T): T {
  if (input === null || typeof input !== "object") {
    return input
  }
  if (Array.isArray(input)) {
    return input.map(item => deepClone(item)) as unknown as T
  }
  const output: any = {}
  for (const key in input as any) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      output[key] = deepClone((input as any)[key])
    }
  }
  return output as T
}

/**
 * Merge two objects deeply, preserving nested structures
 */
export function mergeDeep(target: any, source: any): any {
  if (typeof target !== "object" || target === null) {
    return deepClone(source)
  }
  if (typeof source !== "object" || source === null) {
    return deepClone(source)
  }
  const output = deepClone(target)
  for (const key of Object.keys(source)) {
    if (key in output) {
      output[key] = mergeDeep(output[key], source[key])
    } else {
      output[key] = deepClone(source[key])
    }
  }
  return output
}

/**
 * Check if a value is a non-null object
 */
export function isObject(value: any): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Throttle execution of a function to once per interval
 */
export function throttle<Func extends (...args: any[]) => any>(
  fn: Func,
  wait: number
): Func {
  let lastTime = 0
  return ((...args: any[]) => {
    const now = Date.now()
    if (now - lastTime >= wait) {
      lastTime = now
      return (fn as any)(...args)
    }
  }) as Func
}
