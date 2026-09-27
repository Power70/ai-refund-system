import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Validates that an array of objects has no two entries with the same `key`. */
export function ArrayUniqueBy(key: string, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'arrayUniqueBy',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown) {
          if (!Array.isArray(value)) return true;
          const keys = value.map((v) => (v as Record<string, unknown>)?.[key]);
          return new Set(keys).size === keys.length;
        },
      },
    });
  };
}
