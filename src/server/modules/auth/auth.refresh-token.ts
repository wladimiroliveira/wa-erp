// The refresh token of the API and the session token of the web are the same kind of credential;
// these names keep the API's vocabulary over the shared helpers.
export {
  createOpaqueToken as createRefreshToken,
  expirationFrom as refreshTokenExpiration,
  hashOpaqueToken as hashRefreshToken,
} from "@/server/auth/opaque-token";
