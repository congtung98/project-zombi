/** userData gắn lên RigidBody tĩnh để raycast tương tác/tầm nhìn nhận diện vật chắn. */
export interface BlockerUserData {
  blocksInteraction: true
  id: string
}

export function blockerData(id: string): BlockerUserData {
  return { blocksInteraction: true, id }
}
