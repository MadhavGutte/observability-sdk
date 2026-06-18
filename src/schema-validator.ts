import { z } from 'zod';

// ─── Shared primitives ────────────────────────────────────────────────────────

const labelsSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

// ─── event() ─────────────────────────────────────────────────────────────────

const eventInputSchema = z.object({
  appName: z
    .string()
    .min(1, 'appName must not be empty')
    .max(128, 'appName must not exceed 128 characters')
    .regex(/^[a-zA-Z0-9_\-. ]+$/, 'appName contains invalid characters'),
  eventName: z
    .string()
    .min(1, 'eventName must not be empty')
    .max(256, 'eventName must not exceed 256 characters')
    .regex(/^[a-zA-Z0-9_\-. ]+$/, 'eventName contains invalid characters'),
  value: z.number().finite('value must be a finite number'),
  payload: z.record(z.unknown()).default({}),
  labels: labelsSchema.default({}),
});

export type EventInput = z.infer<typeof eventInputSchema>;

// ─── Validator class ──────────────────────────────────────────────────────────

export class SchemaValidator {
  validateEvent(input: unknown): EventInput {
    const result = eventInputSchema.safeParse(input);
    if (!result.success) {
      throw new SDKValidationError('event', result.error.issues);
    }
    return result.data;
  }
}

export class SDKValidationError extends Error {
  public readonly code = 'SCHEMA_VALIDATION' as const;
  public readonly issues: z.ZodIssue[];

  constructor(kind: string, issues: z.ZodIssue[]) {
    super(
      `[ObservabilitySDK] Validation failed for ${kind}(): ${issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
    this.issues = issues;
    this.name = 'SDKValidationError';
  }
}
