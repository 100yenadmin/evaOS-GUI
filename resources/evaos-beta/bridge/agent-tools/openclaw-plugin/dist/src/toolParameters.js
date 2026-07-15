export function applyToolParameterDefaults(parameters, params) {
  const properties = isRecord(parameters.properties) ? parameters.properties : {};
  const normalized = { ...params };
  for (const [name, property] of Object.entries(properties)) {
    if (
      normalized[name] === undefined &&
      isRecord(property) &&
      Object.prototype.hasOwnProperty.call(property, 'default')
    ) {
      normalized[name] = cloneDefault(property.default);
    }
  }
  return normalized;
}
function cloneDefault(value) {
  if (Array.isArray(value)) {
    return value.map(cloneDefault);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneDefault(entry)]));
  }
  return value;
}
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
