

import { ZodSchema, ZodTypeAny } from "zod"

/**
 * ValidationResult holds the result of a validation
 */
export interface ValidationResult<T> {
  success: boolean
  data?: T
  errors?: string[]
}

/**
 * SchemaRegistry manages named Zod schemas
 */
export class SchemaRegistry {
  private schemas: Map<string, ZodSchema<ZodTypeAny>> = new Map()

  /**
   * Register a Zod schema under a key
   */
  public register(name: string, schema: ZodSchema<ZodTypeAny>): void {
    if (this.schemas.has(name)) {
      throw new Error(`Schema '${name}' is already registered`)
    }
    this.schemas.set(name, schema)
  }

  /**
   * Unregister a schema by name
   */
  public unregister(name: string): void {
    if (!this.schemas.delete(name)) {
      throw new Error(`Schema '${name}' not found`)
    }
  }

  /**
   * Check existence of a schema
   */
  public has(name: string): boolean {
    return this.schemas.has(name)
  }

  /**
   * Retrieve a schema by name
   */
  public get(name: string): ZodSchema<ZodTypeAny> {
    const schema = this.schemas.get(name)
    if (!schema) {
      throw new Error(`Schema '${name}' not found`)
    }
    return schema
  }

  /**
   * List all registered schema names
   */
  public list(): string[] {
    return Array.from(this.schemas.keys())
  }
}

/**
 * Validate data against a named schema in the registry
 * @param registry SchemaRegistry instance
 * @param name Name of the schema to validate against
 * @param input Data to validate
 */
export function validateData<T>(
  registry: SchemaRegistry,
  name: string,
  input: unknown
): ValidationResult<T> {
  if (!registry.has(name)) {
    return { success: false, errors: [`Schema '${name}' is not registered`] }
  }
  try {
    const schema = registry.get(name) as ZodSchema<T>
    const result = schema.safeParse(input)
    if (result.success) {
      return { success: true, data: result.data }
    } else {
      const errors = result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`)
      return { success: false, errors }
    }
  } catch (err: any) {
    return { success: false, errors: [err.message] }
  }
}
