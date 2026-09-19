"use server";

import { redirect } from "next/navigation";
import { signInWithCredentials } from "../../../../modules/auth/authService";

export interface SignInFormState {
  error?: string;
}

export async function signInAction(_prevState: SignInFormState, formData: FormData): Promise<SignInFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const result = await signInWithCredentials(email, password);
  if (!result.success) {
    return { error: result.error ?? "Sign-in failed." };
  }

  redirect("/studio/dashboard");
}
