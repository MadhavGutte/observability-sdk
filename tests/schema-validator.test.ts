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
});
