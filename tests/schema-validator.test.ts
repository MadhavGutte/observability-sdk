import { SchemaValidator, SDKValidationError } from '../src/schema-validator';

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  // ─── validateEvent ──────────────────────────────────────────────────────────

  describe('validateEvent()', () => {
    it('accepts a valid event', () => {
      const result = validator.validateEvent({
        appName: 'my-app',
        eventName: 'user_signup',
        value: 1,
        payload: { userId: 'abc' },
        labels: { region: 'eu-west-1' },
      });

      expect(result.appName).toBe('my-app');
      expect(result.eventName).toBe('user_signup');
      expect(result.value).toBe(1);
    });

    it('applies default payload and labels', () => {
      const result = validator.validateEvent({
        appName: 'my-app',
        eventName: 'click',
        value: 0,
      });
      expect(result.payload).toEqual({});
      expect(result.labels).toEqual({});
    });

    it('rejects an empty appName', () => {
      expect(() =>
        validator.validateEvent({ appName: '', eventName: 'click', value: 1 }),
      ).toThrow(SDKValidationError);
    });

    it('rejects an empty eventName', () => {
      expect(() =>
        validator.validateEvent({ appName: 'app', eventName: '', value: 1 }),
      ).toThrow(SDKValidationError);
    });

    it('rejects Infinity as value', () => {
      expect(() =>
        validator.validateEvent({ appName: 'app', eventName: 'ev', value: Infinity }),
      ).toThrow(SDKValidationError);
    });

    it('rejects NaN as value', () => {
      expect(() =>
        validator.validateEvent({ appName: 'app', eventName: 'ev', value: NaN }),
      ).toThrow(SDKValidationError);
    });

    it('rejects appName with special characters', () => {
      expect(() =>
        validator.validateEvent({ appName: 'app<script>', eventName: 'ev', value: 1 }),
      ).toThrow(SDKValidationError);
    });

    it('SDKValidationError has code SCHEMA_VALIDATION', () => {
      try {
        validator.validateEvent({ appName: '', eventName: 'ev', value: 1 });
      } catch (err) {
        expect(err).toBeInstanceOf(SDKValidationError);
        expect((err as SDKValidationError).code).toBe('SCHEMA_VALIDATION');
      }
    });
  });

  // ─── validateCounter ────────────────────────────────────────────────────────

  describe('validateCounter()', () => {
    it('accepts a valid counter', () => {
      const result = validator.validateCounter({ name: 'http_requests_total', value: 5 });
      expect(result.name).toBe('http_requests_total');
      expect(result.value).toBe(5);
    });

    it('accepts zero value', () => {
      const result = validator.validateCounter({ name: 'my_counter', value: 0 });
      expect(result.value).toBe(0);
    });

    it('rejects negative value', () => {
      expect(() =>
        validator.validateCounter({ name: 'my_counter', value: -1 }),
      ).toThrow(SDKValidationError);
    });

    it('rejects invalid Prometheus metric name (starts with digit)', () => {
      expect(() =>
        validator.validateCounter({ name: '0invalid', value: 1 }),
      ).toThrow(SDKValidationError);
    });

    it('rejects metric name with hyphens', () => {
      expect(() =>
        validator.validateCounter({ name: 'my-metric', value: 1 }),
      ).toThrow(SDKValidationError);
    });

    it('applies default empty labels', () => {
      const result = validator.validateCounter({ name: 'hits_total', value: 1 });
      expect(result.labels).toEqual({});
    });
  });

  // ─── validateGauge ─────────────────────────────────────────────────────────

  describe('validateGauge()', () => {
    it('accepts a positive gauge', () => {
      const result = validator.validateGauge({ name: 'memory_bytes', value: 1024 });
      expect(result.value).toBe(1024);
    });

    it('accepts a negative gauge', () => {
      const result = validator.validateGauge({ name: 'temperature', value: -5.5 });
      expect(result.value).toBe(-5.5);
    });

    it('accepts zero', () => {
      const result = validator.validateGauge({ name: 'queue_depth', value: 0 });
      expect(result.value).toBe(0);
    });

    it('rejects Infinity', () => {
      expect(() =>
        validator.validateGauge({ name: 'my_gauge', value: Infinity }),
      ).toThrow(SDKValidationError);
    });
  });
});
