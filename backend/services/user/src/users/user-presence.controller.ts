import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermission, UserActivityTracker } from "@bitcrm/shared";
import { USER_ONLINE_WINDOW_SECONDS, type UserPresence } from "@bitcrm/types";

/**
 * Admin → Users "Online" / "Last seen". Every signed-in request to any
 * service stamps its user (the shared auth guard → `UserActivityTracker`);
 * this reads the stamps. Registered ahead of `UsersController`, whose
 * `GET /:id` would otherwise take "presence".
 */
@ApiTags("Users")
@ApiBearerAuth()
@Controller()
export class UserPresenceController {
  constructor(private readonly activity: UserActivityTracker) {}

  @Get("presence")
  @RequirePermission("users", "view")
  @ApiOperation({
    summary: "Who is using the platform now",
    description:
      "**Guard:** `users.view` permission required. Every user with a signed-in request in the last half " +
      "year — any page or call from the web or the app — with the time of the last one and `online` when it " +
      `is within ${USER_ONLINE_WINDOW_SECONDS / 60} minutes. Read from Redis; a user is stamped at most once ` +
      "a minute per service instance.",
  })
  async presence(): Promise<{ success: true; data: UserPresence[] }> {
    const now = Date.now();
    const seen = await this.activity.lastSeen(now);
    const data = [...seen].map(([userId, at]) => ({
      userId,
      lastSeenAt: new Date(at).toISOString(),
      online: now - at <= USER_ONLINE_WINDOW_SECONDS * 1000,
    }));
    return { success: true, data };
  }

  @Post("me/heartbeat")
  @HttpCode(200)
  @ApiOperation({
    summary: "The web's open tab says it is still in use",
    description:
      "**Guard:** Authenticated (any role). Sent once a minute while a BitCRM tab is in view, so someone " +
      "reading a page without clicking stays online. The auth guard stamped the caller on the way in; " +
      "nothing else happens.",
  })
  async heartbeat() {
    return { success: true, data: { ok: true } };
  }
}
