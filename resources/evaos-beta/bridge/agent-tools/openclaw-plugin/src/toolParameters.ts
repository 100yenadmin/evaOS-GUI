type JsonSchemaProperty = {
  default?: unknown;
};

export function applyToolParameterDefaults<T extends Record<string, unknown>>(
  parameters: Record<string, unknown>,
  params: T
): T {
  const properties = isRecord(parameters.properties) ? parameters.properties : {};
  const normalized: Record<string, unknown> = { ...params };

  for (const [name, property] of Object.entries(properties)) {
    if (
      normalized[name] === undefined &&
      isRecord(property) &&
      Object.prototype.hasOwnProperty.call(property, 'default')
    ) {
      normalized[name] = cloneDefault((property as JsonSchemaProperty).default);
    }
  }

  return normalized as T;
}

function cloneDefault(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneDefault);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneDefault(entry)]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
