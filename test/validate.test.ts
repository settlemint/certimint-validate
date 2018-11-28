import { CertiMintValidation } from '../src/validate';

test('Initialise the class', () => {
  const certiMintValidation = new CertiMintValidation();
  expect(certiMintValidation).toBeTruthy();
});
