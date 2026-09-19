import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Add Google Workspace scopes for Drive and Forms
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/forms.body');
provider.addScope('https://www.googleapis.com/auth/forms.responses.readonly');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Track auth state listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // Check if we already have the token cached in localStorage as a backup
      const storedToken = localStorage.getItem('music_madras_g_token');
      if (storedToken) {
        cachedAccessToken = storedToken;
      }
      
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // If logged in but no token cached, we can trigger sign in to fetch token
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      localStorage.removeItem('music_madras_g_token');
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Google sign-in flow
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Auth');
    }

    cachedAccessToken = credential.accessToken;
    localStorage.setItem('music_madras_g_token', cachedAccessToken);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken) {
    cachedAccessToken = localStorage.getItem('music_madras_g_token');
  }
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem('music_madras_g_token');
};

// Form Item Question interface
export interface FormQuestion {
  title: string;
  description?: string;
  required: boolean;
  type: 'TEXT' | 'PARAGRAPH' | 'CHOICE';
  choices?: string[];
}

// Programmatically create a Google Form with questions
export const createGoogleForm = async (
  accessToken: string,
  title: string,
  questions: FormQuestion[]
): Promise<{ formId: string; responderUri: string }> => {
  // Step 1: Create the form shell
  const createResponse = await fetch('https://forms.googleapis.com/v1/forms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      info: {
        title: title,
        documentTitle: title,
      },
    }),
  });

  if (!createResponse.ok) {
    const errText = await createResponse.text();
    throw new Error(`Failed to create Google Form: ${errText}`);
  }

  const formData = await createResponse.json();
  const formId = formData.formId;
  const responderUri = formData.responderUri;

  // Step 2: Add questions via batchUpdate
  const requests = questions.map((q, index) => {
    const item: any = {
      title: q.title,
    };

    if (q.description) {
      item.description = q.description;
    }

    if (q.type === 'CHOICE' && q.choices) {
      item.questionItem = {
        question: {
          required: q.required,
          choiceQuestion: {
            type: 'RADIO',
            options: q.choices.map((c) => ({ value: c })),
          },
        },
      };
    } else {
      item.questionItem = {
        question: {
          required: q.required,
          textQuestion: {
            paragraph: q.type === 'PARAGRAPH',
          },
        },
      };
    }

    return {
      createItem: {
        item: item,
        location: {
          index: index,
        },
      },
    };
  });

  const updateResponse = await fetch(`https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests,
    }),
  });

  if (!updateResponse.ok) {
    const errText = await updateResponse.text();
    throw new Error(`Failed to add questions to form: ${errText}`);
  }

  return { formId, responderUri };
};

export interface FormSubmission {
  responseId: string;
  createTime: string;
  answers: { [questionTitle: string]: string };
}

// Fetch form structure and all responses
export const fetchFormResponses = async (
  accessToken: string,
  formId: string
): Promise<{ title: string; responderUri: string; submissions: FormSubmission[] }> => {
  // 1. Fetch form metadata (to map questionId to question text)
  const formRes = await fetch(`https://forms.googleapis.com/v1/forms/${formId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!formRes.ok) {
    throw new Error(`Failed to fetch form structure: ${formRes.statusText}`);
  }

  const formMeta = await formRes.json();
  const formTitle = formMeta.info?.title || 'Form';
  const responderUri = formMeta.responderUri;

  // Build a map of questionId -> questionTitle
  const questionMap: { [questionId: string]: string } = {};
  if (formMeta.items) {
    formMeta.items.forEach((item: any) => {
      if (item.questionItem?.question?.questionId) {
        questionMap[item.questionItem.question.questionId] = item.title;
      }
    });
  }

  // 2. Fetch responses
  const responsesRes = await fetch(`https://forms.googleapis.com/v1/forms/${formId}/responses`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!responsesRes.ok) {
    if (responsesRes.status === 404) {
      // No responses yet
      return { title: formTitle, responderUri, submissions: [] };
    }
    throw new Error(`Failed to fetch form responses: ${responsesRes.statusText}`);
  }

  const responsesData = await responsesRes.json();
  const rawSubmissions = responsesData.responses || [];

  // Map answers using questionTitles
  const submissions: FormSubmission[] = rawSubmissions.map((sub: any) => {
    const answers: { [questionTitle: string]: string } = {};
    if (sub.answers) {
      Object.keys(sub.answers).forEach((qId) => {
        const ansObj = sub.answers[qId];
        const questionTitle = questionMap[qId] || `Question (${qId})`;
        const textVals = ansObj.textAnswers?.answers?.map((a: any) => a.value) || [];
        answers[questionTitle] = textVals.join(', ');
      });
    }

    return {
      responseId: sub.responseId,
      createTime: sub.createTime,
      answers,
    };
  });

  // Sort submissions by createTime descending (newest first)
  submissions.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());

  return {
    title: formTitle,
    responderUri,
    submissions,
  };
};
