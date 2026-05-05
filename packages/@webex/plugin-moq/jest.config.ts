export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {diagnostics: false}],
  },
  moduleNameMapper: {
    '^@web-moq/core$': '<rootDir>/test/__mocks__/@web-moq/core.ts',
    '^@web-moq/media$': '<rootDir>/test/__mocks__/@web-moq/media.ts',
    '^@web-moq/msf$': '<rootDir>/test/__mocks__/@web-moq/msf.ts',
    '^@webex/webex-core$': '<rootDir>/test/__mocks__/@webex/webex-core.ts',
  },
};
