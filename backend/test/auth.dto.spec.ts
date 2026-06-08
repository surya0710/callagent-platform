import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from '../src/modules/auth/dto/login.dto';
import { RegisterAdminDto } from '../src/modules/auth/dto/register-admin.dto';

describe('Auth DTO validation', () => {
  it('rejects invalid login payload', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'not-an-email',
      password: 'short',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid login payload', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'admin@example.com',
      password: 'SecurePass123!',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects register admin with missing fields', async () => {
    const dto = plainToInstance(RegisterAdminDto, {
      email: 'admin@example.com',
      password: 'SecurePass123!',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts valid register admin payload', async () => {
    const dto = plainToInstance(RegisterAdminDto, {
      email: 'admin@example.com',
      password: 'SecurePass123!',
      firstName: 'Jane',
      lastName: 'Admin',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
