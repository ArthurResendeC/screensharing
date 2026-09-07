import { notFound } from "next/navigation";
import { ScreenShare } from "@/components/ScreenShare";
import { roomIdSchema } from "@/lib/signaling/messages";

export default async function Room({
	params,
}: {
	params: Promise<{ roomId: string }>;
}) {
	const { roomId } = await params;
	if (!roomIdSchema.safeParse(roomId).success) notFound();
	return <ScreenShare roomId={roomId} />;
}
