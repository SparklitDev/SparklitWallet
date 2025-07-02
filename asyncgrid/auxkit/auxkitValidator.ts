
import { ServiceConfig } from "./auxkit"

/**
 * Validate that a string is non-empty
 */
function validateString(value: any, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Field '${field}' must be a non-empty string`)
  }
}

/**
 * Validate that a value is an object if defined
 */
function validateMetadata(metadata: any): void {
  if (metadata !== undefined && (typeof metadata !== "object" || Array.isArray(metadata))) {
    throw new Error(`Field 'metadata' must be an object if provided`)
  }
}

/**
 * Validate the shape of a ServiceConfig before registration
 */
export function validateServiceConfig(config: ServiceConfig): void {
  if (config === null || typeof config !== "object") {
    throw new Error("ServiceConfig must be a valid object")
  }
  validateString(config.name, "name")
  validateString(config.version, "version")
  validateMetadata(config.metadata)
}
