import {redirect} from "next/navigation";

/**
 * Create is a pop-up over the home feed, not a page. This route stays so every
 * existing link to it — Learn's, anyone's bookmark — still opens it.
 */
export default function CreatePage() {
  redirect("/home?create=1");
}
