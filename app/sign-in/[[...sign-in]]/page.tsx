import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { PageSpinner } from "@/components/ui";

// <SignIn /> reads the URL (path routing), so it renders behind a Suspense boundary.
export default function SignInPage() {
  return (
    <div className="flex justify-center py-10">
      <Suspense fallback={<PageSpinner />}>
        <SignIn />
      </Suspense>
    </div>
  );
}
