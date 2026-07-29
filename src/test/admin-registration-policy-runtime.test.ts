import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const registerSource = readFileSync('supabase/functions/auth-register/index.ts', 'utf8');
const authErrorSource = readFileSync('supabase/functions/_shared/authErrors.ts', 'utf8');
const messageSource = readFileSync('src/services/authErrorMessageService.ts', 'utf8');
const authPageSource = readFileSync('src/pages/Auth.tsx', 'utf8');

describe('admin registration policy runtime contract', () => {
  it('checks the policy before rate limits or account creation', () => {
    const startHandler = registerSource.slice(
      registerSource.indexOf('async function handleRegistrationStart'),
      registerSource.indexOf('async function handleRegistrationFinish'),
    );
    const policyIndex = startHandler.indexOf('.rpc("is_public_registration_open")');

    expect(policyIndex).toBeGreaterThan(0);
    expect(policyIndex).toBeLessThan(startHandler.indexOf('checkAuthRateLimit'));
    expect(policyIndex).toBeLessThan(startHandler.indexOf('createOpaqueOnlyUser'));
    expect(startHandler).toContain('registrationOpen !== true');
    expect(startHandler).toContain('REGISTRATION_CLOSED');
  });

  it('allows an already-started registration to finish without rechecking a later closure', () => {
    const finishHandler = registerSource.slice(
      registerSource.indexOf('async function handleRegistrationFinish'),
      registerSource.indexOf('function sanitizeAuthError'),
    );

    expect(finishHandler).not.toContain('is_public_registration_open');
    expect(finishHandler).toContain('opaque_registration_challenges');
    expect(finishHandler).toContain('verificationClient.auth.verifyOtp');
    expect(finishHandler.indexOf('pendingChallenge')).toBeLessThan(finishHandler.indexOf('verificationClient.auth.verifyOtp'));
    expect(finishHandler).toContain('verifiedUser.id !== pendingChallenge.user_id');
    expect(finishHandler).toContain('verifiedUser.email_confirmed_at');
    expect(finishHandler).toContain('supabaseAdmin.rpc("finish_opaque_signup"');
    expect(finishHandler).not.toContain('rollbackRegistrationStart(verifiedUser.id, registrationId)');
    expect(finishHandler).toContain('finalizedRecord?.user_id === verifiedUser.id');
    expect(finishHandler).toContain('.eq("registration_record", registrationRecord)');
  });

  it('maps the closed state to a stable user-facing error', () => {
    expect(authErrorSource).toContain('REGISTRATION_CLOSED: "REGISTRATION_CLOSED"');
    expect(messageSource).toContain("| 'REGISTRATION_CLOSED'");
    expect(messageSource).toContain("case 'REGISTRATION_CLOSED':");
  });

  it('submits the OPAQUE record only together with the signup verification code', () => {
    const signupHandler = authPageSource.slice(
      authPageSource.indexOf('const handleSignup = async'),
      authPageSource.indexOf('const handleVerifySignup = async'),
    );
    const verifyHandler = authPageSource.slice(
      authPageSource.indexOf('const handleVerifySignup = async'),
      authPageSource.indexOf('const handleRecover = async'),
    );

    expect(signupHandler).toContain('pendingSignupRef.current =');
    expect(signupHandler).not.toContain("action: 'finish'");
    expect(verifyHandler).toContain("action: 'finish'");
    expect(verifyHandler).toContain('verificationCode: data.code');
    expect(verifyHandler.indexOf("action: 'finish'")).toBeLessThan(verifyHandler.indexOf('await handleLogin'));
  });

  it('allows only an app-owned pending signup without an OPAQUE record to restart after client state loss', () => {
    const startHandler = registerSource.slice(
      registerSource.indexOf('async function handleRegistrationStart'),
      registerSource.indexOf('async function handleRegistrationFinish'),
    );

    expect(startHandler).toContain('canRestartPendingSignup');
    expect(startHandler).toContain('normalizeOpaqueIdentifier(existingAuthUser.user.email) === email');
    expect(startHandler).toContain('.eq("purpose", "signup")');
    expect(startHandler).toContain('.is("consumed_at", null)');
    expect(startHandler).toContain('createDecoyRegistrationStart');
    expect(startHandler).toContain('deleteUser(existingUserId)');
  });

  it('does not reveal existing account or pending-signup state in start responses', () => {
    const startHandler = registerSource.slice(
      registerSource.indexOf('async function handleRegistrationStart'),
      registerSource.indexOf('async function handleRegistrationFinish'),
    );

    expect(startHandler).not.toContain('AUTH_ERROR_CODES.ACCOUNT_ALREADY_EXISTS');
    expect(startHandler).not.toContain('AUTH_ERROR_CODES.OPAQUE_RECORD_CONFLICT');
    expect(startHandler).not.toContain('AUTH_ERROR_CODES.REGISTRATION_PENDING');
    expect(startHandler.match(/createDecoyRegistrationStart/g)?.length).toBeGreaterThanOrEqual(3);
    expect(registerSource).toContain('purpose: "signup-decoy"');
    expect(registerSource).toContain('user_id: null');
    expect(registerSource).toContain('email: "signup-decoy@example.invalid"');
  });

  it('rate-limits signup OTP verification and resets only after a verified code', () => {
    const finishHandler = registerSource.slice(
      registerSource.indexOf('async function handleRegistrationFinish'),
      registerSource.indexOf('function sanitizeAuthError'),
    );

    expect(finishHandler).toContain('action: "opaque_register_verify"');
    expect(finishHandler).toContain('value: pendingChallenge.email');
    expect(finishHandler).toContain('value: `signup-decoy:${registrationId}`');
    expect(finishHandler).toContain('.in("purpose", ["signup", "signup-decoy"])');
    expect(finishHandler).toContain('pendingChallenge.purpose !== "signup"');
    expect(finishHandler).toContain('normalizeOpaqueIdentifier(pendingChallenge.email) !== email');
    expect(finishHandler).toContain('recordAuthRateLimitFailure(verifyRateLimit)');
    expect(finishHandler).toContain('resetAuthRateLimit(verifyRateLimit)');
    expect(finishHandler.indexOf('resetAuthRateLimit')).toBeGreaterThan(finishHandler.indexOf('verifiedUser.email_confirmed_at'));
  });
});
