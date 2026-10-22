export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {diagnostics: false}],
  },
  moduleNameMapper: {
    '^@moq-web/core$': '<rootDir>/test/__mocks__/@moq-web/core.ts',
    '^@moq-web/media$': '<rootDir>/test/__mocks__/@moq-web/media.ts',
    '^@moq-web/msf$': '<rootDir>/test/__mocks__/@moq-web/msf.ts',
    '^@webex/webex-core$': '<rootDir>/test/__mocks__/@webex/webex-core.ts',
  },
};
