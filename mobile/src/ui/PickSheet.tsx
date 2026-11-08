import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, s } from "./components";
import { TOUCH, useTheme } from "./theme";

export type PickOption = { key: string; label: string; detail?: string; selected?: boolean };

/** A list to pick one thing from (an owner, a day), as a sheet over the screen. */
export function PickSheet({ title, options, visible, onPick, onClose }: { title: string; options: PickOption[]; visible: boolean; onPick: (key: string) => void; onClose: () => void }) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => undefined} style={{ maxHeight: "75%" }}>
          <Card style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 28, gap: 4 }}>
            <Text style={[s.h2, { color: t.text, marginBottom: 6 }]}>{title}</Text>
            <ScrollView>
              {options.map((o) => (
                <Pressable
                  key={o.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: o.selected }}
                  onPress={() => onPick(o.key)}
                  style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.body, { color: t.text, fontWeight: o.selected ? "700" : "400" }]}>{o.label}</Text>
                    {o.detail ? <Text style={{ color: t.muted, fontSize: 13 }}>{o.detail}</Text> : null}
                  </View>
                  {o.selected ? <Ionicons name="checkmark" size={22} color={t.brand} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
