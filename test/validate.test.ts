import { CertiMintValidation } from '../src/validate';

describe('certiMintValidation', () => {
  describe('Initialise the class', () => {
    const certiMintValidation = new CertiMintValidation();
    expect(certiMintValidation).toBeTruthy();
  });
});
