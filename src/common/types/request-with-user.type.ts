import { Request } from 'express';
import { AuthenticatedUser } from './authenticated-user.type';

export type RequestWithUser = Request & { user: AuthenticatedUser };
