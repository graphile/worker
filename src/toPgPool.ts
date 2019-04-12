import { Pool } from "pg";
import { mixed } from "./interfaces";

function isPlainObject(obj: any) {
  if (!obj || typeof obj !== "object" || String(obj) !== "[object Object]") {
    return false;
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto === null || proto === Object.prototype) {
    return true;
  }
  return false;
}

function hasPoolConstructor(obj: mixed): boolean {
  return (
    // tslint:disable-next-line no-any
    (obj &&
      typeof obj.constructor === "function" &&
      obj.constructor === (Pool as any).super_) ||
    false
  );
}

function constructorName(obj: mixed): string | null {
  return (
    (obj &&
      typeof obj.constructor === "function" &&
      obj.constructor.name &&
      String(obj.constructor.name)) ||
    null
  );
}

// tslint:disable-next-line no-any
export default function toPgPool(poolOrConfig: any): Pool {
  if (quacksLikePgPool(poolOrConfig)) {
    // If it is already a `Pool`, just use it.
    return poolOrConfig;
  }

  if (typeof poolOrConfig === "string") {
    // If it is a string, let us parse it to get a config to create a `Pool`.
    return new Pool({ connectionString: poolOrConfig });
  } else if (!poolOrConfig) {
    // Use an empty config and let the defaults take over.
    return new Pool({});
  } else if (isPlainObject(poolOrConfig)) {
    // The user handed over a configuration object, pass it through
    return new Pool(poolOrConfig);
  } else {
    throw new Error("Invalid connection string / Pool ");
  }
}

// tslint:disable-next-line no-any
function quacksLikePgPool(pgConfig: any): pgConfig is Pool {
  if (pgConfig instanceof Pool) {
    return true;
  }
  if (hasPoolConstructor(pgConfig)) {
    return true;
  }

  // A diagnosis of exclusion
  if (!pgConfig || typeof pgConfig !== "object") {
    return false;
  }
  if (
    constructorName(pgConfig) !== "Pool" &&
    constructorName(pgConfig) !== "BoundPool"
  ) {
    return false;
  }
  if (!pgConfig["Client"]) {
    return false;
  }
  if (!pgConfig["options"]) {
    return false;
  }
  if (typeof pgConfig["connect"] !== "function") {
    return false;
  }
  if (typeof pgConfig["end"] !== "function") {
    return false;
  }
  if (typeof pgConfig["query"] !== "function") {
    return false;
  }
  return true;
}
