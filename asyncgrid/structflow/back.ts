
import { ZodSchema, ZodTypeAny } from "zod"
import { ValidationResult, validateData, SchemaRegistry } from "./structflowUtils"

/**
 * StructFlow manages dynamic schemas and validates data against them
 */
export class StructFlow {
  private registry: SchemaRegistry

  constructor() {
    this.registry = new SchemaRegistry()
  }

  /**
   * Register a new schema under a unique key
   * @param name Unique schema name
   * @param schema Zod schema instance
   */
  public registerSchema(name: string, schema: ZodSchema<ZodTypeAny>): void {
    this.registry.register(name, schema)
  }

  /**
   * Unregister an existing schema
   * @param name Schema name to remove
   */
  public unregisterSchema(name: string): void {
    this.registry.unregister(name)
  }

  /**
   * Check if a schema with the given name exists
   * @param name Schema name to check
   */
  public hasSchema(name: string): boolean {
    return this.registry.has(name)
  }

  /**
   * Validate data against a named schema
   * @param name Name of the schema to use
   * @param data Input data to validate
   * @returns ValidationResult with success flag and errors if any
   */
  public validate<T>(name: string, data: unknown): ValidationResult<T> {
    return validateData<T>(this.registry, name, data)
  }

  /**
   * List all registered schema names
   */
  public listSchemas(): string[] {
    return this.registry.list()
  }
}
