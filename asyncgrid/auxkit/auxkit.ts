
import { EventEmitter } from "events"
import { deepClone, mergeDeep } from "./auxkitUtils"
import { validateServiceConfig } from "./auxkitValidator"

/**
 * ServiceConfig defines the shape of a service registration
 */
export interface ServiceConfig {
  name: string
  version: string
  metadata?: Record<string, any>
}

/**
 * Auxkit manages registration and invocation of named services with events
 */
export class Auxkit {
  private services: Map<string, ServiceConfig> = new Map()
  private emitter: EventEmitter = new EventEmitter()

  /**
   * Register a new service
   */
  public registerService(config: ServiceConfig): void {
    validateServiceConfig(config)
    if (this.services.has(config.name)) {
      throw new Error(`Service '${config.name}' is already registered`)
    }
    const cloned = deepClone(config)
    this.services.set(config.name, cloned)
    this.emitter.emit("service:registered", cloned)
  }

  /**
   * Unregister an existing service by name
   */
  public unregisterService(name: string): void {
    if (!this.services.has(name)) {
      throw new Error(`Service '${name}' not found`)
    }
    this.services.delete(name)
    this.emitter.emit("service:unregistered", name)
  }

  /**
   * Retrieve a registered service config
   */
  public getService(name: string): ServiceConfig {
    const config = this.services.get(name)
    if (!config) {
      throw new Error(`Service '${name}' not found`)
    }
    return mergeDeep({}, config) as ServiceConfig
  }

  /**
   * List all registered service names
   */
  public listServices(): string[] {
    return Array.from(this.services.keys())
  }

  /**
   * Subscribe to internal events
   */
  public on(event: "service:registered" | "service:unregistered", listener: Function): void {
    this.emitter.on(event, listener)
  }

  /**
   * Emit a custom event
   */
  public emit(event: string, payload?: any): void {
    this.emitter.emit(event, payload)
  }

  /**
   * Clear all registered services
   */
  public clearAll(): void {
    this.services.clear()
    this.emitter.emit("services:cleared")
  }
}
